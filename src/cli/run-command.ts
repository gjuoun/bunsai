import { loadPipeline } from "../config/load.ts";
import { runPipeline } from "../pipeline/runner/run.ts";
import { renderRunResult } from "./render.ts";

/** Execute the `run` command and return the process exit code. */
export async function executeRun(from: string | undefined, force: boolean): Promise<number> {
  const cwd = process.cwd();
  try {
    const pipeline = await loadPipeline(cwd);
    const result = await runPipeline(pipeline, { root: cwd, from, force });
    renderRunResult(result);
    return result.ok ? 0 : 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}