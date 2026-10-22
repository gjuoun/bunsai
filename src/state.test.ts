import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, statePath, type PipelineState, type StepRecord } from "./state.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bunsai-state-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const successRec: StepRecord = { status: "success", startedAt: "2026-10-22T10:00:00Z", endedAt: "2026-10-22T10:00:01Z", attempts: 1 };

describe("state store", () => {
  test("statePath is .bunsai/state.json under the pipeline root", () => {
    expect(statePath("/repo")).toBe(join("/repo", ".bunsai", "state.json"));
  });

  test("loadState returns empty object when no state file exists", () => {
    expect(loadState(root)).toEqual({});
  });

  test("saveState + loadState roundtrip", () => {
    const state: PipelineState = { build: successRec };
    saveState(root, state);
    expect(existsSync(statePath(root))).toBe(true);
    expect(loadState(root)).toEqual(state);
  });

  test("saveState creates the .bunsai directory if missing", () => {
    expect(existsSync(join(root, ".bunsai"))).toBe(false);
    saveState(root, { build: successRec });
    expect(existsSync(statePath(root))).toBe(true);
  });

  test("loadState tolerates corrupted JSON and starts fresh", () => {
    mkdirSync(join(root, ".bunsai"), { recursive: true });
    writeFileSync(statePath(root), "{not json");
    expect(loadState(root)).toEqual({});
  });

  test("loadState reports unreadable state with a path in the message", () => {
    mkdirSync(join(root, ".bunsai"), { recursive: true });
    writeFileSync(statePath(root), '{"build": {"status": 42}}');
    expect(() => loadState(root)).toThrow(/state\.json/);
  });
});
