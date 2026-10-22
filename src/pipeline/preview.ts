import type { PipelineState, PipelineStep } from "../types.ts";
import { cacheVerdict } from "./cache-verdict.ts";
import type { CacheReason } from "./cache-verdict.ts";
import { downstreamOf } from "./runner/graph.ts";
import { topoLayers } from "./scheduler.ts";

/** One step as a dry run sees it: will it execute, or is the cache still valid? */
export interface PreviewStep {
  readonly name: string;
  readonly status: "run" | "cached";
  readonly reason: CacheReason;
  readonly dependsOn: string[];
  readonly retries: number;
  /** Attempts/duration of the cached record, when one exists. */
  readonly attempts?: number;
  readonly durationMs?: number;
}

export interface StepPlan {
  /** Topological layers in run order; a layer's steps are unordered siblings. */
  readonly layers: string[][];
  readonly entries: Map<string, PreviewStep>;
}

export interface PreviewOptions {
  readonly force?: boolean;
  readonly from?: string;
}

/**
 * Pure dry-run plan: layers from `topoLayers`, per-step verdict from the shared
 * `cacheVerdict` rule. Nothing here touches disk — the caller hashes inputs and
 * loads state. Only facts are reported: a step is never marked blocked, because
 * blocking requires a dependency to fail in an actual run.
 */
export function planPreview(
  steps: PipelineStep[],
  prior: PipelineState,
  hashes: ReadonlyMap<string, string>,
  options: PreviewOptions = {}
): StepPlan {
  const layers = topoLayers(steps);
  if (options.from !== undefined && !steps.some((s) => s.name === options.from)) {
    throw new Error(
      `bunsai: --from step "${options.from}" not found in pipeline (steps: ${steps.map((s) => s.name).join(", ")})`
    );
  }
  const rerun = options.from !== undefined ? downstreamOf(steps, options.from) : new Set<string>();
  const byName = new Map(steps.map((s) => [s.name, s]));
  const entries = new Map<string, PreviewStep>();

  for (const layer of layers) {
    for (const name of layer) {
      const step = byName.get(name)!;
      const forced = options.force === true || rerun.has(name);
      const verdict = cacheVerdict(prior[name], hashes.get(name), { forced });
      entries.set(name, {
        name,
        status: verdict.cached ? "cached" : "run",
        reason: verdict.reason,
        dependsOn: [...(step.dependsOn ?? [])],
        retries: step.retries ?? 0,
        attempts: prior[name]?.attempts,
        durationMs: prior[name]?.durationMs,
      });
    }
  }
  return { layers, entries };
}
