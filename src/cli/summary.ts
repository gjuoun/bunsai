import { topoLayers } from "../pipeline/scheduler.ts";
import type { PipelineStep, RunResult } from "../types.ts";
import { renderResultGraph } from "./graph-render.ts";
import type { ResultStepView } from "./graph-render.ts";
import { formatMs } from "./render.ts";

/**
 * Post-run report: the layered graph annotated with the live outcome, then the
 * frozen summary lines (`total:` and the success/failure sentence).
 */
export function renderRunResult(result: RunResult, steps: readonly PipelineStep[]): void {
  const byName = new Map(steps.map((step) => [step.name, step]));
  const views = new Map<string, ResultStepView>(
    result.steps.map((step) => [
      step.name,
      {
        status: step.status,
        cached: step.cached,
        attempts: step.attempts,
        durationMs: step.durationMs,
        dependsOn: byName.get(step.name)?.dependsOn,
      },
    ])
  );
  console.log("");
  for (const line of renderResultGraph(topoLayers(steps), views)) console.log(line);
  const done = result.steps.filter((s) => s.status === "success").length;
  const total = result.steps.length;
  console.log("");
  console.log(`total: ${formatMs(result.totalMs)}`);
  console.log(
    result.ok
      ? `✓ ${done}/${total} steps succeeded`
      : "✗ pipeline failed — fix the failing step and rerun (already-successful steps are skipped; `--from <step>` forces a step and its downstream to rerun)"
  );
}
