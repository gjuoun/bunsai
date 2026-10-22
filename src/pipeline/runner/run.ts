import { Effect, Layer } from "effect";
import type { Pipeline, RunOptions, RunResult } from "../../types.ts";
import { defaultLogger, loggerLayer } from "../../services/logger.ts";
import { resolveRunConfig, runConfigLayer } from "../../services/run-config.ts";
import { runLogLayer } from "../../services/run-log.ts";
import { shellRunnerLayer } from "../../services/shell-runner.ts";
import { stateStoreLayer } from "../../services/state-store.ts";
import { PipelineRunner } from "./pipeline-runner.ts";
import { pipelineRunnerLayer } from "./pipeline-runner.ts";

/**
 * Public facade: keep the Promise-based signature (and plain-Error rejection)
 * while the work happens inside the PipelineRunner service.
 */
export async function runPipeline(pipeline: Pipeline, options: RunOptions): Promise<RunResult> {
  const resolved = resolveRunConfig(options);
  const logger = options.logger ?? defaultLogger;
  const config = runConfigLayer(options);
  const dependencies = Layer.mergeAll(
    config,
    shellRunnerLayer.pipe(Layer.provide(config)),
    stateStoreLayer(options.root),
    loggerLayer(logger),
    runLogLayer(resolved.root, logger, resolved.cwd)
  );
  const program = Effect.gen(function* () {
    const runner = yield* PipelineRunner;
    return yield* runner.run(pipeline);
  });
  return await Effect.runPromise(program.pipe(Effect.provide(pipelineRunnerLayer.pipe(Layer.provide(dependencies)))));
}