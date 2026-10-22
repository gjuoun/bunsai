import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "./runner.ts";
import { loadState } from "./state.ts";
import type { Pipeline, PipelineStep, Logger } from "./types.ts";

let root: string;
let logs: string[];
const captureLogger: Logger = {
  info: (m) => logs.push(m),
  error: (m) => logs.push(m),
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bunsai-run-"));
  logs = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const opts = (extra = {}) => ({ root, logger: captureLogger, ...extra });

describe("runPipeline", () => {
  test("runs steps and returns success with timing", async () => {
    const ran: string[] = [];
    const pipeline: Pipeline = {
      steps: [{ name: "a", run: () => void ran.push("a") }],
    };
    const result = await runPipeline(pipeline, opts());
    expect(result.ok).toBe(true);
    expect(ran).toEqual(["a"]);
    expect(result.steps[0]!.status).toBe("success");
    expect(typeof result.steps[0]!.durationMs).toBe("number");
  });

  test("runs independent steps in parallel (overlap observed)", async () => {
    let inflight = 0;
    let max = 0;
    const slow = (): PipelineStep => ({
      name: `s${Math.random()}`,
      run: async () => {
        inflight++;
        max = Math.max(max, inflight);
        await new Promise((r) => setTimeout(r, 40));
        inflight--;
      },
    });
    const pipeline: Pipeline = { steps: [slow(), slow(), slow()] };
    await runPipeline(pipeline, opts());
    expect(max).toBeGreaterThan(1);
  });

  test("caps parallelism at the semaphore limit (default 4)", async () => {
    let inflight = 0;
    let max = 0;
    const step = (i: number): PipelineStep => ({
      name: `p${i}`,
      run: async () => {
        inflight++;
        max = Math.max(max, inflight);
        await new Promise((r) => setTimeout(r, 40));
        inflight--;
      },
    });
    const pipeline: Pipeline = { steps: Array.from({ length: 8 }, (_, i) => step(i)) };
    await runPipeline(pipeline, opts());
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
  });

  test("waits for dependsOn before running dependents", async () => {
    const order: string[] = [];
    const pipeline: Pipeline = {
      steps: [
        { name: "first", run: async () => { await new Promise((r) => setTimeout(r, 30)); order.push("first"); } },
        { name: "second", dependsOn: ["first"], run: () => void order.push("second") },
      ],
    };
    await runPipeline(pipeline, opts());
    expect(order).toEqual(["first", "second"]);
  });

  test("retries a transiently failing step and records attempts", async () => {
    let calls = 0;
    const pipeline: Pipeline = {
      steps: [
        {
          name: "flaky",
          retries: 2,
          run: () => {
            calls++;
            if (calls < 2) throw new Error("transient");
          },
        },
      ],
    };
    const result = await runPipeline(pipeline, opts());
    expect(result.ok).toBe(true);
    expect(result.steps[0]!.attempts).toBe(2);
    expect(loadState(root).flaky!.attempts).toBe(2);
    expect(loadState(root).flaky!.status).toBe("success");
  });

  test("exhausts retries, fails the run, and skips downstream steps", async () => {
    const ran: string[] = [];
    const pipeline: Pipeline = {
      steps: [
        { name: "boom", retries: 1, run: () => { throw new Error("always"); } },
        { name: "solo", run: () => void ran.push("solo") },
        { name: "after", dependsOn: ["boom"], run: () => void ran.push("after") },
      ],
    };
    const result = await runPipeline(pipeline, opts());
    expect(result.ok).toBe(false);
    const boom = result.steps.find((s) => s.name === "boom")!;
    expect(boom.status).toBe("failure");
    expect(boom.attempts).toBe(2);
    expect(boom.error).toContain("always");
    const after = result.steps.find((s) => s.name === "after")!;
    expect(after.status).toBe("skipped");
    expect(ran).toEqual(["solo"]);
    expect(loadState(root).boom!.status).toBe("failure");
  });

  test("skips cached-success steps on rerun with 'skip (cached)' log", async () => {
    let ran = 0;
    const pipeline: Pipeline = { steps: [{ name: "cached", run: () => void ran++ }] };
    await runPipeline(pipeline, opts());
    const result2 = await runPipeline(pipeline, opts());
    expect(ran).toBe(1);
    expect(result2.steps[0]!.status).toBe("skipped");
    expect(result2.steps[0]!.cached).toBe(true);
    expect(logs.some((l) => l.includes("skip (cached)") && l.includes("cached"))).toBe(true);
  });

  test("--from reruns the named step and its downstream, keeps upstream cached", async () => {
    const ran: string[] = [];
    const pipeline: Pipeline = {
      steps: [
        { name: "a", run: () => void ran.push("a") },
        { name: "b", dependsOn: ["a"], run: () => void ran.push("b") },
        { name: "c", dependsOn: ["b"], run: () => void ran.push("c") },
        { name: "side", run: () => void ran.push("side") },
      ],
    };
    await runPipeline(pipeline, opts()); // all success
    ran.length = 0;
    const result = await runPipeline(pipeline, opts({ from: "b" }));
    expect(ran.sort()).toEqual(["b", "c"]);
    expect(result.steps.find((s) => s.name === "a")!.cached).toBe(true);
    expect(result.steps.find((s) => s.name === "b")!.cached).toBeUndefined();
  });

  test("--force reruns everything", async () => {
    let ran = 0;
    const pipeline: Pipeline = { steps: [{ name: "a", run: () => void ran++ }] };
    await runPipeline(pipeline, opts());
    const result = await runPipeline(pipeline, opts({ force: true }));
    expect(ran).toBe(2);
    expect(result.steps[0]!.cached).toBeUndefined();
  });

  test("unknown --from step throws with the step name", async () => {
    const pipeline: Pipeline = { steps: [{ name: "a", run: () => {} }] };
    await expect(runPipeline(pipeline, opts({ from: "nope" }))).rejects.toThrow(/nope/);
  });

  test("a failed step runs again on plain rerun (not cached)", async () => {
    let calls = 0;
    const pipeline: Pipeline = {
      steps: [
        {
          name: "recover",
          run: () => {
            calls++;
            if (calls === 1) throw new Error("first run fails");
          },
        },
      ],
    };
    const r1 = await runPipeline(pipeline, opts());
    expect(r1.ok).toBe(false);
    const r2 = await runPipeline(pipeline, opts());
    expect(r2.ok).toBe(true);
    expect(r2.steps[0]!.attempts).toBe(1);
  });
});
