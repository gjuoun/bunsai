import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecordFile } from "./run-record.ts";
import {
  latestRunPath,
  newRunId,
  readRunRecord,
  runPath,
  tailLines,
  writeRunRecord,
} from "./run-record.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "bunsai-runs-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const record = (runId: string, steps: RunRecordFile["steps"] = []): RunRecordFile => ({
  schemaVersion: 1,
  runId,
  startedAt: "2026-10-22T14:13:05.123Z",
  steps,
});

describe("run record", () => {
  test("writes and reads a record under .bunsai/runs", () => {
    const file = record("20261022T141305123Z", [
      { name: "build", status: "success", attempts: 1, startedAt: "2026-10-22T14:13:05.123Z" },
    ]);
    const path = writeRunRecord(root, file);
    expect(path).toBe(runPath(root, file.runId));
    expect(path).toContain(join(".bunsai", "runs"));
    expect(readRunRecord(path)).toEqual(file);
  });

  test("run ids are sortable and filesystem-safe", () => {
    const early = newRunId(new Date("2026-10-22T14:13:05.123Z"));
    const late = newRunId(new Date("2026-10-22T14:13:06.000Z"));
    expect(early).toBe("20261022T141305123Z");
    expect(late).toBe("20261022T141306000Z");
    expect(early < late).toBe(true);
    expect(early).toMatch(/^[0-9]{8}T[0-9]{9}Z$/);
  });

  test("latestRunPath picks the newest id", () => {
    writeRunRecord(root, record("20261022T100000000Z"));
    writeRunRecord(root, record("20261022T141305123Z"));
    writeRunRecord(root, record("20261022T120000000Z"));
    expect(latestRunPath(root)).toBe(runPath(root, "20261022T141305123Z"));
  });

  test("latestRunPath is undefined without a runs directory", () => {
    expect(latestRunPath(root)).toBeUndefined();
  });

  test("unparseable JSON names the path", () => {
    const path = runPath(root, "bad");
    writeRunRecord(root, record("bad"));
    writeFileSync(path, "{not json");
    expect(() => readRunRecord(path)).toThrow(/bad\.json/);
    expect(existsSync(path)).toBe(true);
  });

  test("a partial record (crashed run) still parses", () => {
    const path = writeRunRecord(root, record("20261022T141305123Z"));
    const parsed = readRunRecord(path);
    expect(parsed.endedAt).toBeUndefined();
    expect(parsed.steps).toEqual([]);
  });

  test("tailLines keeps the last n lines", () => {
    expect(tailLines("a\nb\nc\nd\n", 2)).toBe("c\nd");
    expect(tailLines("a\nb", 10)).toBe("a\nb");
    expect(tailLines("", 3)).toBe("");
    expect(tailLines("a\n", 0)).toBe("");
  });
});
