import { Context, Effect, Layer } from "effect";
import type {
  Pipeline,
  PipelineState,
  PipelineStep,
  RunResult,
  StepOutcome,
  StepRecord,
} from "../../types.ts";
import { LoggerService } from "../../services/logger.ts";
import type { Logger } from "../../types.ts";
import { RunConfig } from "../../services/run-config.ts";
import type { RunConfigShape } from "../../services/run-config.ts";
import { ShellRunner } from "../../services/shell-runner.ts";
import type { ShellRunnerShape } from "../../services/shell-runner.ts";
import { RunLog } from "../../services/run-log.ts";
import type { RunLogShape } from "../../services/run-log.ts";
import { StateStore } from "../../services/state-store.ts";
import type { StateStoreShape } from "../../services/state-store.ts";
import { hashStep } from "../input-hash.ts";
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
    private readonly config: RunConfigShape,
    private readonly runLog: RunLogShape
  ) {}

  run(pipeline: Pipeline): Effect.Effect<RunResult, Error> {
    const { store, shell, logger, config, runLog } = this;

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
        runLog,
      };

      for (const layer of layers) {
        const runnable: { step: PipelineStep; inputHash: string }[] = [];
        for (const name of layer) {
          const step = byName.get(name)!;
          const depBlocked = (step.dependsOn ?? []).some((d) => blocked.has(d));
          // Hashing reads declared inputs, so it happens here (inside Effect.sync)
          // rather than in a pure helper; an I/O error fails the run with a plain Error.
          const inputHash = depBlocked
            ? undefined
            : yield* Effect.sync(() => hashStep(step, config.cwd));
          const forced = config.force || rerunSet.has(name);
          const previouslyOk = prior[name]?.status === "success";
          const hashMatches = inputHash !== undefined && prior[name]?.inputHash === inputHash;
          const cached = !forced && previouslyOk && hashMatches;
          if (depBlocked) {
            blocked.add(name);
            const startedAt = new Date().toISOString();
            const record: StepRecord = { status: "skipped", startedAt, attempts: 0 };
            state[name] = record;
            yield* store.save(state);
            yield* runLog.recordStep({ name, status: "skipped", attempts: 0, startedAt });
            outcomes.push({ name, status: "skipped", attempts: 0 });
          } else if (cached) {
            logger.info(`skip (cached): ${name}`);
            yield* runLog.recordStep({
              name,
              status: "skipped",
              attempts: prior[name]!.attempts,
              startedAt: new Date().toISOString(),
              cached: true,
              inputHash,
            });
            outcomes.push({ name, status: "skipped", attempts: prior[name]!.attempts, cached: true });
          } else {
            if (!forced && previouslyOk && !hashMatches) {
              logger.info(`cache invalidated: ${name} (input hash changed)`);
            }
            runnable.push({ step, inputHash: inputHash! });
          }
        }
        if (runnable.length === 0) continue;
        yield* Effect.forEach(
          runnable,
          ({ step, inputHash }) =>
            semaphore.withPermits(1)(runStep(step, runtime, inputHash)).pipe(
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
      const totalMs = Date.now() - runStart;
      yield* runLog.finish(ok, totalMs);
      return { ok, steps: outcomes, totalMs };
    });
  }
}

export const pipelineRunnerLayer: Layer.Layer<
  PipelineRunner,
  never,
  StateStore | ShellRunner | LoggerService | RunConfig | RunLog
> = Layer.effect(
  PipelineRunner,
  Effect.gen(function* () {
    const store = yield* StateStore;
    const shell = yield* ShellRunner;
    const logger = yield* LoggerService;
    const config = yield* RunConfig;
    const runLog = yield* RunLog;
    return new LivePipelineRunner(store, shell, logger, config, runLog);
  })
);
