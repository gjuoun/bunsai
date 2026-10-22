import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestRunPath, readRunRecord } from "../services/run-record.ts";
import { runPipeline } from "./runner/run.ts";
import type { Logger, Pipeline } from "../types.ts";

let root: string;
let logs: string[];
const captureLogger: Logger = {
  info: (m) => logs.push(m),
  error: (m) => logs.push(m),
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bunsai-logging-"));
  logs = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const opts = (extra = {}) => ({ root, logger: captureLogger, ...extra });

describe("run logging", () => {
  test("tees shell output into the step log and records it in the run record", async () => {
    const pipeline: Pipeline = {
      steps: [
        {
          name: "shelled",
          run: async (ctx) => {
            ctx.logger.info("building");
            await ctx.shell("echo from-shell");
          },
        },
      ],
    };
    const result = await runPipeline(pipeline, opts());
    expect(result.ok).toBe(true);
    const record = readRunRecord(latestRunPath(root)!);
    const stepRecord = record.steps.find((s) => s.name === "shelled")!;
    expect(stepRecord.logPath).toBeDefined();
    expect(stepRecord.logPath).toContain(join(".bunsai", "logs", record.runId));
    const logged = readFileSync(stepRecord.logPath!, "utf8");
    expect(logged).toContain("from-shell");
    expect(logged).toContain("[bunsai] building");
  });

  test("the run record lists cached and dep-blocked steps, and a failed run", async () => {
    let calls = 0;
    const pipeline: Pipeline = {
      steps: [
        { name: "ok", run: () => {} },
        {
          name: "boom",
          run: () => {
            calls++;
            throw new Error("kaboom");
          },
        },
        { name: "after", dependsOn: ["boom"], run: () => {} },
      ],
    };
    const first = await runPipeline(pipeline, opts());
    expect(first.ok).toBe(false);
    const firstRecord = readRunRecord(latestRunPath(root)!);
    expect(firstRecord.ok).toBe(false);
    expect(firstRecord.steps.map((s) => s.name).sort()).toEqual(["after", "boom", "ok"]);
    const boom = firstRecord.steps.find((s) => s.name === "boom")!;
    expect(boom.status).toBe("failure");
    expect(boom.error).toContain("kaboom");
    expect(boom.logPath).toBeDefined();

    const second = await runPipeline(pipeline, opts());
    expect(second.ok).toBe(false);
    const secondRecord = readRunRecord(latestRunPath(root)!);
    const cachedStep = secondRecord.steps.find((s) => s.name === "ok")!;
    expect(cachedStep.status).toBe("skipped");
    expect(cachedStep.cached).toBe(true);
    const blocked = secondRecord.steps.find((s) => s.name === "after")!;
    expect(blocked.status).toBe("skipped");
    expect(blocked.cached).toBeUndefined();
    expect(calls).toBe(2);
  });
});
