import { Context, Effect, Layer } from "effect";
import type { Pipeline, PipelineState, RunResult, StepOutcome, StepRecord } from "../../types.ts";
import { LoggerService } from "../../services/logger.ts";
import type { Logger } from "../../types.ts";
import { RunConfig } from "../../services/run-config.ts";
import type { RunConfigShape } from "../../services/run-config.ts";
import { ShellRunner } from "../../services/shell-runner.ts";
import type { ShellRunnerShape } from "../../services/shell-runner.ts";
import { StateStore } from "../../services/state-store.ts";
import type { StateStoreShape } from "../../services/state-store.ts";
import { topoLayers } from "../scheduler.ts";
import { downstreamOf } from "./graph.ts";
import { runStep } from "./step.ts";
import type { StepRuntime } from "./step.ts";

export interface PipelineRunnerShape {
  run(pipeline: Pipeline): Effect.Effect<RunResult, Error>;
}

export class PipelineRunner extends Context.Tag("bunsai/PipelineRunner")<PipelineRunner, PipelineRunnerShape>() {}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/**
 * Executes a pipeline: topological layers, steps inside a layer bounded by an
 * Effect Semaphore, per-step retries, cache/`--from`/`--force` handling, and
 * state persisted after every step. All I/O goes through injected services.
 */
export class LivePipelineRunner implements PipelineRunnerShape {
  constructor(
    private readonly store: StateStoreShape,
    private readonly shell: ShellRunnerShape,
    private readonly logger: Logger,
    private readonly config: RunConfigShape
  ) {}

  run(pipeline: Pipeline): Effect.Effect<RunResult, Error> {
    const { store, shell, logger, config } = this;

    return Effect.gen(function* () {
      const layers = yield* Effect.try({ try: () => topoLayers(pipeline.steps), catch: asError });

      if (config.from !== undefined && !pipeline.steps.some((s) => s.name === config.from)) {
        return yield* Effect.fail(
          new Error(
            `bunsai: --from step "${config.from}" not found in pipeline (steps: ${pipeline.steps.map((s) => s.name).join(", ")})`
          )
        );
      }
      const rerunSet = config.from !== undefined ? downstreamOf(pipeline.steps, config.from) : new Set<string>();

      const prior = yield* store.load();
      // Mutable state, seeded from prior runs and re-persisted after every step so
      // sibling records from the same run are never clobbered.
      const state: PipelineState = { ...prior };
      const byName = new Map(pipeline.steps.map((s) => [s.name, s]));

      const outcomes: StepOutcome[] = [];
      const blocked = new Set<string>(); // steps whose state is failure or dep-blocked
      const semaphore = Effect.unsafeMakeSemaphore(config.concurrency);
      const runStart = Date.now();
      const runtime: StepRuntime = {
        cwd: config.cwd,
        env: config.env as Record<string, string>,
        logger,
        shell,
        store,
        state,
      };

      for (const layer of layers) {
        const runnable = [];
        for (const name of layer) {
          const step = byName.get(name)!;
          const depBlocked = (step.dependsOn ?? []).some((d) => blocked.has(d));
          const cached = !config.force && !rerunSet.has(name) && prior[name]?.status === "success";
          if (depBlocked) {
            blocked.add(name);
            const record: StepRecord = { status: "skipped", startedAt: new Date().toISOString(), attempts: 0 };
            state[name] = record;
            yield* store.save(state);
            outcomes.push({ name, status: "skipped", attempts: 0 });
          } else if (cached) {
            logger.info(`skip (cached): ${name}`);
            outcomes.push({ name, status: "skipped", attempts: prior[name]!.attempts, cached: true });
          } else {
            runnable.push(step);
          }
        }
        if (runnable.length === 0) continue;
        yield* Effect.forEach(
          runnable,
          (step) =>
            semaphore.withPermits(1)(runStep(step, runtime)).pipe(
              Effect.flatMap((outcome) =>
                Effect.sync(() => {
                  outcomes.push(outcome);
                  if (outcome.status !== "success") blocked.add(step.name);
                })
              )
            ),
          { concurrency: "unbounded" }
        );
      }

      const ok = outcomes.every((o) => o.status !== "failure");
      return { ok, steps: outcomes, totalMs: Date.now() - runStart };
    });
  }
}

export const pipelineRunnerLayer: Layer.Layer<
  PipelineRunner,
  never,
  StateStore | ShellRunner | LoggerService | RunConfig
> = Layer.effect(
  PipelineRunner,
  Effect.gen(function* () {
    const store = yield* StateStore;
    const shell = yield* ShellRunner;
    const logger = yield* LoggerService;
    const config = yield* RunConfig;
    return new LivePipelineRunner(store, shell, logger, config);
  })
);