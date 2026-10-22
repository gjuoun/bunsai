import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPipeline } from "./cli.ts";

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

describe("cli end-to-end (@effect/cli)", () => {
  let root: string;
  const cliPath = join(import.meta.dir, "cli.ts");

  function runCli(args: string[], cwd: string) {
    const proc = Bun.spawnSync({ cmd: ["bun", cliPath, ...args], cwd, stdout: "pipe", stderr: "pipe" });
    return {
      exitCode: proc.exitCode,
      out: new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr),
    };
  }

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
    const first = runCli(["run"], root);
    expect(first.exitCode).toBe(0);
    expect(first.out).toContain("greet");
    expect(first.out).toContain("build");
    expect(first.out).toContain("2/2");

    const second = runCli(["run"], root);
    expect(second.exitCode).toBe(0);
    expect(second.out).toContain("skip (cached)");

    const forced = runCli(["run", "--force"], root);
    expect(forced.exitCode).toBe(0);
    expect(forced.out).not.toContain("skip (cached)");

    const fromBuild = runCli(["run", "--from", "build"], root);
    expect(fromBuild.exitCode).toBe(0);
  });

  test("failing pipeline exits 1 and names the step", () => {
    writeFileSync(
      join(root, "bunsai.config.ts"),
      `export default { steps: [{ name: "boom", retries: 1, run: () => { throw new Error("kaboom"); } }] };\n`
    );
    const run = runCli(["run"], root);
    expect(run.exitCode).toBe(1);
    expect(run.out).toContain("boom");
    expect(run.out).toContain("kaboom");
  });

  test("missing config exits 1 with guidance", () => {
    const run = runCli(["run"], root);
    expect(run.exitCode).toBe(1);
    expect(run.out).toContain("bunsai.config.ts");
  });

  test("--help exits 0 and documents --from/--force", () => {
    const help = runCli(["run", "--help"], root);
    expect(help.exitCode).toBe(0);
    expect(help.out).toContain("--from");
    expect(help.out).toContain("--force");
  });

  test("unknown flag exits non-zero with an error", () => {
    const bad = runCli(["run", "--wat"], root);
    expect(bad.exitCode).not.toBe(0);
  });

  test("unknown subcommand exits non-zero", () => {
    const bad = runCli(["deploy"], root);
    expect(bad.exitCode).not.toBe(0);
  });
});
