import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { Logger } from "../types.ts";
import { readRunRecord, runPath } from "./run-record.ts";
import { FileRunLog, stepSlug } from "./run-log.ts";

let root: string;
const lines: string[] = [];
const logger: Logger = { info: (m) => lines.push(m), error: (m) => lines.push(m) };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bunsai-runlog-"));
  lines.length = 0;
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("FileRunLog", () => {
  test("creates the runs dir, the log dir, and an empty record", () => {
    const log = new FileRunLog(root, logger);
    expect(existsSync(log.dir)).toBe(true);
    expect(log.dir).toContain(join(".bunsai", "logs", log.runId));
    const record = readRunRecord(runPath(root, log.runId));
    expect(record.runId).toBe(log.runId);
    expect(record.schemaVersion).toBe(1);
    expect(record.steps).toEqual([]);
    expect(lines.some((l) => l.includes(log.runId))).toBe(true);
  });

  test("logPath puts <step>.log under the run dir", () => {
    const log = new FileRunLog(root, logger);
    expect(log.logPath("unit test")).toBe(join(log.dir, "unit-test.log"));
    expect(stepSlug(" build/linux ")).toBe("build-linux");
  });

  test("an unusable step name fails with the name in the message", () => {
    const log = new FileRunLog(root, logger);
    expect(() => log.logPath("///")).toThrow(/cannot be used as a log file name/);
  });

  test("the sink appends chunks to the step log", () => {
    const log = new FileRunLog(root, logger);
    const sink = log.outputSink("build");
    sink(new TextEncoder().encode("one\n"));
    sink(new TextEncoder().encode("two\n"));
    expect(readFileSync(log.logPath("build"), "utf8")).toBe("one\ntwo\n");
  });

  test("records every step incrementally, then finishes the run", async () => {
    const log = new FileRunLog(root, logger);
    const recordPath = runPath(root, log.runId);
    await Effect.runPromise(
      log.recordStep({ name: "build", status: "success", attempts: 1, startedAt: "2026-10-22T14:13:05.123Z" })
    );
    expect(readRunRecord(recordPath).steps.map((s) => s.name)).toEqual(["build"]);
    await Effect.runPromise(log.finish(true, 42));
    const done = readRunRecord(recordPath);
    expect(done.ok).toBe(true);
    expect(done.durationMs).toBe(42);
    expect(typeof done.endedAt).toBe("string");
  });

  test("a record write failure names the run record path", async () => {
    const log = new FileRunLog(root, logger);
    const recordPath = runPath(root, log.runId);
    rmSync(recordPath);
    mkdirSync(recordPath);
    const error = await Effect.runPromise(
      Effect.flip(
        log.recordStep({ name: "build", status: "success", attempts: 1, startedAt: "2026-10-22T14:13:05.123Z" })
      )
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(recordPath);
  });
});
