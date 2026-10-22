import { Context, Effect, Layer } from "effect";
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Logger, OutputSink } from "../types.ts";
import type { RunRecordFile, RunStepRecord } from "./run-record.ts";
import { RUN_SCHEMA_VERSION, newRunId, runPath, runsDir, writeRunRecord } from "./run-record.ts";

export interface RunLogShape {
  /** Id of this run; also the stem of its record and log directory. */
  readonly runId: string;
  /** Absolute directory holding this run's step logs. */
  readonly dir: string;
  logPath(step: string): string;
  /** Lazy O_APPEND writer for one step's combined output. */
  outputSink(step: string): OutputSink;
  /** Insert/replace one step in the run record and persist it immediately. */
  recordStep(step: RunStepRecord): Effect.Effect<void, Error>;
  /** Stamp the run summary, close log fds, persist. */
  finish(ok: boolean, totalMs: number): Effect.Effect<void, Error>;
}

/** File-system-safe step log stem; unsafe characters collapse to "-". */
export function stepSlug(name: string): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") {
    throw new Error(`bunsai: step name ${JSON.stringify(name)} cannot be used as a log file name — rename the step`);
  }
  return slug;
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/**
 * Per-run logging: creates .bunsai/runs/<run-id>.json and
 * .bunsai/logs/<run-id>/<step>.log, writing the record after every step so a
 * killed run still leaves a readable partial history.
 */
export class FileRunLog implements RunLogShape {
  readonly runId: string;
  readonly dir: string;
  private readonly record: RunRecordFile;
  private readonly fds = new Map<string, number>();

  constructor(
    private readonly root: string,
    private readonly logger: Logger,
    cwd: string = root
  ) {
    mkdirSync(runsDir(root), { recursive: true });
    let stamp = Date.now();
    let id = newRunId(new Date(stamp));
    // Two runs can start inside the same millisecond: bump until the id is free.
    while (existsSync(runPath(root, id))) {
      stamp += 1;
      id = newRunId(new Date(stamp));
    }
    this.runId = id;
    this.dir = join(root, ".bunsai", "logs", id);
    mkdirSync(this.dir, { recursive: true });
    this.record = {
      schemaVersion: RUN_SCHEMA_VERSION,
      runId: id,
      startedAt: new Date().toISOString(),
      cwd,
      root,
      steps: [],
    };
    writeRunRecord(root, this.record);
    this.logger.info(`run ${id} — logs in ${join(".bunsai", "logs", id)}`);
  }

  logPath(step: string): string {
    return join(this.dir, `${stepSlug(step)}.log`);
  }

  outputSink(step: string): OutputSink {
    const path = this.logPath(step);
    return (chunk: Uint8Array): void => {
      let fd = this.fds.get(step);
      if (fd === undefined) {
        fd = openSync(path, "a");
        this.fds.set(step, fd);
      }
      writeSync(fd, chunk);
    };
  }

  recordStep(step: RunStepRecord): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const index = this.record.steps.findIndex((s) => s.name === step.name);
        if (index === -1) this.record.steps.push(step);
        else this.record.steps[index] = step;
        writeRunRecord(this.root, this.record);
      },
      catch: (err) =>
        new Error(
          `bunsai: failed to write run record ${runPath(this.root, this.runId)}: ${asError(err).message}`
        ),
    });
  }

  finish(ok: boolean, totalMs: number): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        this.closeAll();
        this.record.endedAt = new Date().toISOString();
        this.record.durationMs = totalMs;
        this.record.ok = ok;
        writeRunRecord(this.root, this.record);
      },
      catch: (err) =>
        new Error(
          `bunsai: failed to finish run record ${runPath(this.root, this.runId)}: ${asError(err).message}`
        ),
    });
  }

  private closeAll(): void {
    for (const fd of this.fds.values()) closeSync(fd);
    this.fds.clear();
  }
}

export class RunLog extends Context.Tag("bunsai/RunLog")<RunLog, RunLogShape>() {}

export const runLogLayer = (root: string, logger: Logger, cwd?: string): Layer.Layer<RunLog> =>
  Layer.effect(RunLog, Effect.sync(() => new FileRunLog(root, logger, cwd)));
