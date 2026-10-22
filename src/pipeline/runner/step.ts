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
}

/**
 * One step: the attempt loop, exponential backoff, and the state write after
 * every terminal outcome. Failures become StepOutcomes (never an Effect
 * failure), so one red step does not tear down its siblings.
 */
export const runStep = (step: PipelineStep, runtime: StepRuntime): Effect.Effect<StepOutcome> =>
  Effect.gen(function* () {
    const start = Date.now();
    const totalAttempts = 1 + (step.retries ?? 0);
    const ctx: StepContext = {
      cwd: runtime.cwd,
      env: runtime.env,
      logger: runtime.logger,
      shell: runtime.shell.forStep(step.name),
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
        };
        runtime.state[step.name] = record;
        yield* runtime.store.save(runtime.state);
        return { name: step.name, status: "success" as const, attempts, durationMs };
      }
      const squashed = Cause.squash(outcome.cause);
      failure = squashed instanceof Error ? squashed : new Error(String(squashed));
      runtime.logger.error(
        `step "${step.name}" attempt ${attempt}/${totalAttempts} failed: ${failure.message}`
      );
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
    };
    runtime.state[step.name] = record;
    yield* runtime.store.save(runtime.state);
    runtime.logger.error(`step "${step.name}" failed after ${attempts} attempt(s): ${error}`);
    return { name: step.name, status: "failure" as const, attempts, durationMs, error };
  });