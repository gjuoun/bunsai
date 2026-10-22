import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPipeline, parseArgs } from "./cli.ts";

describe("parseArgs", () => {
  test("bare run", () => {
    expect(parseArgs(["run"])).toEqual({ command: "run", force: false });
  });

  test("--force flag", () => {
    expect(parseArgs(["run", "--force"])).toEqual({ command: "run", force: true });
  });

  test("--from step", () => {
    expect(parseArgs(["run", "--from", "build"])).toEqual({ command: "run", from: "build", force: false });
  });

  test("--from=step form", () => {
    expect(parseArgs(["run", "--from=build"])).toEqual({ command: "run", from: "build", force: false });
  });

  test("combines --from and --force", () => {
    expect(parseArgs(["run", "--from", "build", "--force"])).toEqual({ command: "run", from: "build", force: true });
  });

  test("rejects unknown commands", () => {
    expect(() => parseArgs(["deploy"])).toThrow(/unknown command "deploy"/);
  });

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["run", "--wat"])).toThrow(/--wat/);
  });

  test("--from requires a value", () => {
    expect(() => parseArgs(["run", "--from"])).toThrow(/--from/);
  });

  test("no command prints usage error", () => {
    expect(() => parseArgs([])).toThrow(/usage/i);
  });
});

describe("loadPipeline", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bunsai-cli-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("imports default export from bunsai.config.ts", async () => {
    writeFileSync(
      join(root, "bunsai.config.ts"),
      `export default { steps: [{ name: "hello", run: () => {} }] };\n`
    );
    const pipeline = await loadPipeline(root);
    expect(pipeline.steps[0]!.name).toBe("hello");
  });

  test("accepts named export 'pipeline'", async () => {
    writeFileSync(
      join(root, "bunsai.config.ts"),
      `export const pipeline = { steps: [{ name: "named", run: () => {} }] };\n`
    );
    const pipeline = await loadPipeline(root);
    expect(pipeline.steps[0]!.name).toBe("named");
  });

  test("missing config file points at the path and an example", async () => {
    await expect(loadPipeline(root)).rejects.toThrow(/bunsai\.config\.ts/);
    await expect(loadPipeline(root)).rejects.toThrow(/examples/);
  });

  test("config without steps is rejected", async () => {
    writeFileSync(join(root, "bunsai.config.ts"), `export default { oops: true };\n`);
    await expect(loadPipeline(root)).rejects.toThrow(/steps/);
  });
});

describe("cli end-to-end", () => {
  let root: string;
  const cliPath = join(import.meta.dir, "cli.ts");
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bunsai-e2e-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("runs a pipeline, prints timing summary, then serves from cache", () => {
    writeFileSync(
      join(root, "bunsai.config.ts"),
      `export default {
  steps: [
    { name: "greet", run: (ctx) => ctx.shell("echo hello from " + ctx.cwd) },
    { name: "build", dependsOn: ["greet"], run: () => {} },
  ],
};
`
    );
    const first = Bun.spawnSync({ cmd: ["bun", cliPath, "run"], cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(first.exitCode).toBe(0);
    const out1 = new TextDecoder().decode(first.stdout);
    expect(out1).toContain("greet");
    expect(out1).toContain("build");
    expect(out1).toContain("2/2");

    const second = Bun.spawnSync({ cmd: ["bun", cliPath, "run"], cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(second.exitCode).toBe(0);
    const out2 = new TextDecoder().decode(second.stdout);
    expect(out2).toContain("skip (cached)");

    const forced = Bun.spawnSync({ cmd: ["bun", cliPath, "run", "--force"], cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(forced.exitCode).toBe(0);
    expect(new TextDecoder().decode(forced.stdout)).not.toContain("skip (cached)");
  });

  test("failing pipeline exits 1 and names the step", () => {
    writeFileSync(
      join(root, "bunsai.config.ts"),
      `export default { steps: [{ name: "boom", retries: 1, run: () => { throw new Error("kaboom"); } }] };\n`
    );
    const run = Bun.spawnSync({ cmd: ["bun", cliPath, "run"], cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode).toBe(1);
    const all = new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr);
    expect(all).toContain("boom");
    expect(all).toContain("kaboom");
  });

  test("missing config exits 1 with guidance", () => {
    const run = Bun.spawnSync({ cmd: ["bun", cliPath, "run"], cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode).toBe(1);
    const all = new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr);
    expect(all).toContain("bunsai.config.ts");
  });
});
