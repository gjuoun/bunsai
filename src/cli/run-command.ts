import { loadPipeline } from "../config/load.ts";
import { hashStep } from "../pipeline/input-hash.ts";
import { planPreview } from "../pipeline/preview.ts";
import { runPipeline } from "../pipeline/runner/run.ts";
import { loadState } from "../services/state.ts";
import { renderPlanGraph } from "./graph-render.ts";
import { executeLast } from "./last.ts";
import { renderRunResult } from "./summary.ts";

/** One `bunsai run` invocation, resolved from the CLI flags. */
export interface RunCommandOptions {
  readonly from?: string;
  readonly force?: boolean;
  readonly last?: boolean;
  readonly dryRun?: boolean;
}

/** Execute the `run` command and return the process exit code. */
export async function executeRun(options: RunCommandOptions = {}): Promise<number> {
  const { from, force = false, last = false, dryRun = false } = options;
  const cwd = process.cwd();
  try {
    if (last) {
      if (from !== undefined || force || dryRun) {
        throw new Error(
          "bunsai: --last reports the previous run and cannot be combined with --from, --force or --dry-run"
        );
      }
      return executeLast(cwd);
    }
    const pipeline = await loadPipeline(cwd);
    if (dryRun) return printPlan(pipeline.steps, cwd, { force, from });
    const result = await runPipeline(pipeline, { root: cwd, from, force });
    renderRunResult(result, pipeline.steps);
    return result.ok ? 0 : 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/** `--dry-run`: report what would happen, execute nothing, write nothing. */
function printPlan(
  steps: Awaited<ReturnType<typeof loadPipeline>>["steps"],
  cwd: string,
  options: { force: boolean; from: string | undefined }
): number {
  const prior = loadState(cwd);
  const hashes = new Map(steps.map((step) => [step.name, hashStep(step, cwd)]));
  const plan = planPreview(steps, prior, hashes, options);
  for (const line of renderPlanGraph(plan)) console.log(line);
  console.log("");
  console.log("dry-run: nothing executed");
  return 0;
}
