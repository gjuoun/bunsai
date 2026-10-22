import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState } from "../services/state.ts";
import { runPipeline } from "./runner/run.ts";
import type { Logger, Pipeline, PipelineStep } from "../types.ts";

let root: string;
let logs: string[];
const captureLogger: Logger = {
  info: (m) => logs.push(m),
  error: (m) => logs.push(m),
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bunsai-cache-"));
  logs = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const opts = (extra = {}) => ({ root, logger: captureLogger, ...extra });

describe("input-hash cache", () => {
  test("keeps a step cached while its declared input is unchanged", async () => {
    let ran = 0;
    writeFileSync(join(root, "input.txt"), "one\n");
    const pipeline: Pipeline = {
      steps: [{ name: "hashed", inputs: ["input.txt"], run: () => void ran++ }],
    };
    await runPipeline(pipeline, opts());
    const record = loadState(root).hashed!;
    expect(record.inputHash?.startsWith("sha256:")).toBe(true);

    const second = await runPipeline(pipeline, opts());
    expect(ran).toBe(1);
    expect(second.steps[0]!.cached).toBe(true);
  });

  test("reruns a step when a declared input changes", async () => {
    let ran = 0;
    writeFileSync(join(root, "input.txt"), "one\n");
    const pipeline: Pipeline = {
      steps: [{ name: "hashed", inputs: ["input.txt"], run: () => void ran++ }],
    };
    await runPipeline(pipeline, opts());
    writeFileSync(join(root, "input.txt"), "two\n");
    const second = await runPipeline(pipeline, opts());
    expect(ran).toBe(2);
    expect(second.steps[0]!.cached).toBeUndefined();
    expect(logs.some((l) => l.includes("cache invalidated") && l.includes("hashed"))).toBe(true);
  });

  test("reruns a step when its definition changes", async () => {
    let ran = 0;
    const step = (retries: number): PipelineStep => ({
      name: "defined",
      retries,
      run: () => void ran++,
    });
    await runPipeline({ steps: [step(0)] }, opts());
    const second = await runPipeline({ steps: [step(1)] }, opts());
    expect(ran).toBe(2);
    expect(second.steps[0]!.attempts).toBe(1);
  });

  test("reruns a step whose state record has no inputHash (pre-0.2 state)", async () => {
    let ran = 0;
    saveState(root, {
      legacy: { status: "success", startedAt: "2026-10-22T10:00:00.000Z", attempts: 1 },
    });
    const pipeline: Pipeline = { steps: [{ name: "legacy", run: () => void ran++ }] };
    const result = await runPipeline(pipeline, opts());
    expect(ran).toBe(1);
    expect(result.steps[0]!.cached).toBeUndefined();
    expect(loadState(root).legacy!.inputHash?.startsWith("sha256:")).toBe(true);
  });
});
