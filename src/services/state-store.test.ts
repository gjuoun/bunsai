import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { PipelineState, StepRecord } from "../types.ts";
import { statePath } from "./state.ts";
import { FileStateStore } from "./state-store.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "bunsai-store-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const successRec: StepRecord = { status: "success", startedAt: "2026-10-22T10:00:00Z", attempts: 1 };

describe("FileStateStore", () => {
  test("serves .bunsai/state.json and loads {} when it is absent", async () => {
    const store = new FileStateStore(root);
    expect(store.path).toBe(statePath(root));
    expect(store.path).toContain(join(".bunsai", "state.json"));
    expect(await Effect.runPromise(store.load())).toEqual({});
  });

  test("save then load roundtrips through the service", async () => {
    const store = new FileStateStore(root);
    const state: PipelineState = { build: successRec };
    await Effect.runPromise(store.save(state));
    expect(existsSync(store.path)).toBe(true);
    expect(await Effect.runPromise(store.load())).toEqual(state);
  });

  test("invalid state fails with a plain Error naming state.json", async () => {
    mkdirSync(join(root, ".bunsai"), { recursive: true });
    writeFileSync(statePath(root), '{"build": {"status": 42}}');
    const error = await Effect.runPromise(Effect.flip(new FileStateStore(root).load()));
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("state.json");
  });
});