import type { StepStatus } from "../types.ts";
import type { StepPlan } from "../pipeline/preview.ts";
import { ICONS, formatMs } from "./render.ts";

/** What a finished step's graph row needs (a live outcome or a run record). */
export interface ResultStepView {
  readonly status: StepStatus;
  readonly cached?: boolean;
  readonly attempts?: number;
  readonly durationMs?: number;
  readonly dependsOn?: readonly string[];
}

const GUTTER = "      ";

function nameWidth(layers: string[][]): number {
  return layers.flat().reduce((max, name) => Math.max(max, name.length), 0);
}

/** Shared geometry: layer marker, tree glyphs, padded name, detail column. */
function renderRows(layers: string[][], detail: (name: string) => string, extra: (name: string) => string): string[] {
  const width = nameWidth(layers);
  const lines: string[] = [];
  layers.forEach((layer, index) => {
    layer.forEach((name, position) => {
      const marker = position === 0 ? `  L${index + 1}  ` : GUTTER;
      const glyph = position === layer.length - 1 ? "└─" : "├─";
      const suffix = extra(name);
      lines.push(marker + glyph + " " + name.padEnd(width) + "  " + detail(name) + suffix);
    });
  });
  return lines;
}

function header(layers: string[][]): string {
  const total = layers.reduce((sum, layer) => sum + layer.length, 0);
  return `layers: ${layers.length} · ${total} steps`;
}

function dependencySuffix(dependsOn: readonly string[] | undefined, retries: number): string {
  const deps = dependsOn !== undefined && dependsOn.length > 0 ? ` ← ${dependsOn.join(", ")}` : "";
  const retry = retries > 0 ? ` · retries ${retries}` : "";
  return deps + retry;
}

/** Dry-run graph: what will happen. No icons — nothing has run yet. */
export function renderPlanGraph(plan: StepPlan): string[] {
  const lines = renderRows(
    plan.layers,
    (name) => {
      const step = plan.entries.get(name)!;
      return step.reason === "cached"
        ? "cached"
        : step.reason === "forced"
          ? "run (forced)"
          : step.reason === "input-changed"
            ? "run (input changed)"
            : step.reason === "prior-failure"
              ? "run (prior failed)"
              : "run";
    },
    (name) => {
      const step = plan.entries.get(name)!;
      return dependencySuffix(step.dependsOn, step.retries);
    }
  );
  return [header(plan.layers), ...lines];
}

/** Post-run graph: what happened, with status icons, durations and attempts. */
export function renderResultGraph(layers: string[][], steps: ReadonlyMap<string, ResultStepView>): string[] {
  const lines = renderRows(
    layers,
    (name) => {
      const step = steps.get(name);
      if (step === undefined) return "? (missing from the run record)";
      if (step.status === "skipped") return step.cached === true ? "⤼ (cached)" : "⤼ (blocked)";
      const time = step.durationMs !== undefined ? ` [${formatMs(step.durationMs)}]` : "";
      const attempts = step.attempts !== undefined ? ` (${step.attempts} attempt${step.attempts === 1 ? "" : "s"})` : "";
      return `${ICONS[step.status]}${time}${attempts}`;
    },
    (name) => dependencySuffix(steps.get(name)?.dependsOn, 0)
  );
  return [header(layers), ...lines];
}
