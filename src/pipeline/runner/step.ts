import { Cause, Duration, Effect, Exit } from "effect";
import type {
  Logger,
  PipelineState,
  PipelineStep,
  StepContext,
  StepOutcome,
  StepRecord,
} from "../../types.ts";
import type { ShellRunnerShape } from "../../services/shell-runner.ts";
import type { RunLogShape } from "../../services/run-log.ts";
import type { StateStoreShape } from "../../services/state-store.ts";
import { backoffMs } from "./graph.ts";

/** Everything one step needs, assembled once per run. */
export interface StepRuntime {
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly logger: Logger;
  readonly shell: ShellRunnerShape;
  readonly store: StateStoreShape;
  /** Shared mutable run state: sibling writes must not clobber each other. */
  readonly state: PipelineState;
  /** This run's record + step log directory. */
  readonly runLog: RunLogShape;
}

/**
 * One step: the attempt loop, exponential backoff, and the state write after
 * every terminal outcome. Failures become StepOutcomes (never an Effect
 * failure), so one red step does not tear down its siblings.
 */
export const runStep = (
  step: PipelineStep,
  runtime: StepRuntime,
  inputHash: string
): Effect.Effect<StepOutcome, Error> =>
  Effect.gen(function* () {
    const start = Date.now();
    const totalAttempts = 1 + (step.retries ?? 0);
    const logPath = runtime.runLog.logPath(step.name);
    const sink = runtime.runLog.outputSink(step.name);
    const toSink = (msg: string): void => sink(new TextEncoder().encode(`[bunsai] ${msg}\n`));
    // Step-scoped logger: the terminal keeps its stream, the step log gets a copy.
    const logger: Logger = {
      info: (msg) => {
        runtime.logger.info(msg);
        toSink(msg);
      },
      error: (msg) => {
        runtime.logger.error(msg);
        toSink(msg);
      },
    };
    const ctx: StepContext = {
      cwd: runtime.cwd,
      env: runtime.env,
      logger,
      shell: runtime.shell.forStep(step.name, sink),
    };

    let attempts = 0;
    let failure: Error | undefined;
    while (attempts < totalAttempts) {
      attempts++;
      const attempt = attempts;
      const outcome = yield* Effect.exit(
        Effect.tryPromise({
          try: () => Promise.resolve(step.run(ctx)),
          catch: (err) => (err instanceof Error ? err : new Error(String(err))),
        })
      );
      if (Exit.isSuccess(outcome)) {
        const durationMs = Date.now() - start;
        const record: StepRecord = {
          status: "success",
          startedAt: new Date(start).toISOString(),
          endedAt: new Date().toISOString(),
          attempts,
          durationMs,
          inputHash,
        };
        runtime.state[step.name] = record;
        yield* runtime.store.save(runtime.state);
        yield* runtime.runLog.recordStep({ ...record, name: step.name, logPath, dependsOn: step.dependsOn });
        return { name: step.name, status: "success" as const, attempts, durationMs };
      }
      const squashed = Cause.squash(outcome.cause);
      failure = squashed instanceof Error ? squashed : new Error(String(squashed));
      logger.error(`step "${step.name}" attempt ${attempt}/${totalAttempts} failed: ${failure.message}`);
      if (attempts < totalAttempts) {
        yield* Effect.sleep(Duration.millis(backoffMs(attempts)));
      }
    }

    const durationMs = Date.now() - start;
    const error = failure?.message ?? "unknown error";
    const record: StepRecord = {
      status: "failure",
      startedAt: new Date(start).toISOString(),
      endedAt: new Date().toISOString(),
      attempts,
      durationMs,
      inputHash,
    };
    runtime.state[step.name] = record;
    yield* runtime.store.save(runtime.state);
    yield* runtime.runLog.recordStep({ ...record, name: step.name, logPath, error, dependsOn: step.dependsOn });
    logger.error(`step "${step.name}" failed after ${attempts} attempt(s): ${error}`);
    return { name: step.name, status: "failure" as const, attempts, durationMs, error };
  });