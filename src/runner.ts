import { Cause, Duration, Effect, Exit } from "effect";
import { makeShell } from "./services/shell.ts";
import { topoLayers } from "./pipeline/scheduler.ts";
import { loadState, saveState, type PipelineState, type StepRecord } from "./services/state.ts";
import type {
  Logger,
  Pipeline,
  PipelineStep,
  RunOptions,
  RunResult,
  StepContext,
  StepOutcome,
} from "./types.ts";


const DEFAULT_CONCURRENCY = 4;
const RETRY_BASE_MS = 50;
const RETRY_CAP_MS = 2_000;

export const defaultLogger: Logger = {
  info: (msg) => console.log(`[bunsai] ${msg}`),
  error: (msg) => console.error(`[bunsai] ${msg}`),
};

/** Step names that transitively depend on `target` (target included). */
function downstreamOf(steps: PipelineStep[], target: string): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), step.name]);
    }
  }
  const closure = new Set<string>([target]);
  const queue = [target];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const dependent of dependents.get(current) ?? []) {
      if (!closure.has(dependent)) {
        closure.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return closure;
}

function backoffMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS);
}

/**
 * Execute a pipeline: topological layers from the scheduler, steps inside a
 * layer run in parallel bounded by an Effect Semaphore, per-step retries with
 * exponential backoff, cache/`--from`/`--force` handling, and state persisted
 * to <root>/.bunsai/state.json after every step.
 */
export async function runPipeline(pipeline: Pipeline, options: RunOptions): Promise<RunResult> {
  const { root, force = false, concurrency = DEFAULT_CONCURRENCY } = options;
  const cwd = options.cwd ?? root;
  const env = options.env ?? process.env;
  const logger = options.logger ?? defaultLogger;

  const layers = topoLayers(pipeline.steps);

  if (options.from !== undefined && !pipeline.steps.some((s) => s.name === options.from)) {
    throw new Error(`bunsai: --from step "${options.from}" not found in pipeline (steps: ${pipeline.steps.map((s) => s.name).join(", ")})`);
  }
  const rerunSet = options.from !== undefined ? downstreamOf(pipeline.steps, options.from) : new Set<string>();

  const prior: PipelineState = loadState(root);
  // Mutable state, seeded from prior runs and re-persisted after every step so
  // sibling records from the same run are never clobbered.
  const state: PipelineState = { ...prior };
  const byName = new Map(pipeline.steps.map((s) => [s.name, s]));

  const outcomes: StepOutcome[] = [];
  const blocked = new Set<string>(); // steps whose state is failure or dep-blocked
  const semaphore = Effect.unsafeMakeSemaphore(concurrency);
  const runStart = Date.now();

  const runOne = (step: PipelineStep): Effect.Effect<StepOutcome> =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        const start = Date.now();
        const totalAttempts = 1 + (step.retries ?? 0);
        const ctx: StepContext = {
          cwd,
          env: env as Record<string, string>,
          logger,
          shell: makeShell(step.name, cwd, env),
        };

        let attempts = 0;
        let failure: Error | undefined;
        while (attempts < totalAttempts) {
          attempts++;
          const attempt = attempts;
          const outcome = yield* Effect.exit(
            Effect.tryPromise({
              try: () => Promise.resolve(step.run(ctx)),
              catch: (e) => (e instanceof Error ? e : new Error(String(e))),
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
            state[step.name] = record;
            saveState(root, state);
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
        };
        state[step.name] = record;
        saveState(root, state);
        logger.error(`step "${step.name}" failed after ${attempts} attempt(s): ${error}`);
        return { name: step.name, status: "failure" as const, attempts, durationMs, error };
      })
    );

  for (const layer of layers) {
    const runnable: PipelineStep[] = [];
    for (const name of layer) {
      const step = byName.get(name)!;
      const depBlocked = (step.dependsOn ?? []).some((d) => blocked.has(d));
      const cached = !force && !rerunSet.has(name) && prior[name]?.status === "success";
      if (depBlocked) {
        blocked.add(name);
        const record: StepRecord = { status: "skipped", startedAt: new Date().toISOString(), attempts: 0 };
        state[name] = record;
        saveState(root, state);
        outcomes.push({ name, status: "skipped", attempts: 0 });
      } else if (cached) {
        logger.info(`skip (cached): ${name}`);
        outcomes.push({ name, status: "skipped", attempts: prior[name]!.attempts, cached: true });
      } else {
        runnable.push(step);
      }
    }
    if (runnable.length === 0) continue;
    await Effect.runPromise(
      Effect.forEach(runnable, (step) =>
        runOne(step).pipe(
          Effect.flatMap((outcome) =>
            Effect.sync(() => {
              outcomes.push(outcome);
              if (outcome.status !== "success") blocked.add(step.name);
            })
          )
        ),
        { concurrency: "unbounded" }
      )
    );
  }

  const ok = outcomes.every((o) => o.status !== "failure");
  return { ok, steps: outcomes, totalMs: Date.now() - runStart };
}
