import { loadPipeline } from "../config/load.ts";
import { runPipeline } from "../pipeline/runner/run.ts";
import { executeLast } from "./last.ts";
import { renderRunResult } from "./render.ts";

/** Execute the `run` command and return the process exit code. */
export async function executeRun(
  from: string | undefined,
  force: boolean,
  last = false
): Promise<number> {
  const cwd = process.cwd();
  try {
    if (last) {
      if (from !== undefined || force) {
        throw new Error("bunsai: --last reports the previous run and cannot be combined with --from or --force");
      }
      return executeLast(cwd);
    }
    const pipeline = await loadPipeline(cwd);
    const result = await runPipeline(pipeline, { root: cwd, from, force });
    renderRunResult(result);
    return result.ok ? 0 : 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
