import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPipeline } from "./config/load.ts";

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

  test("--last prints the previous run's summary and tails the failed step's log", () => {
    writeFileSync(
      join(root, "bunsai.config.ts"),
      `export default {
  steps: [
    {
      name: "boom",
      run: (ctx) => {
        ctx.logger.info("before-boom");
        throw new Error("kaboom");
      },
    },
  ],
};
`
    );
    const failed = runCli(["run"], root);
    expect(failed.exitCode).toBe(1);

    const replay = runCli(["run", "--last"], root);
    expect(replay.exitCode).toBe(0);
    expect(replay.out).toContain("run 2");
    expect(replay.out).toContain("layers: 1 · 1 steps");
    expect(replay.out).toContain("boom");
    expect(replay.out).toContain("✗ run failed — 1 step(s) failed");
    expect(replay.out).toContain("(last 40 lines)");
    expect(replay.out).toContain("kaboom");
  });

  test("--last without history exits 1 and points at .bunsai/runs", () => {
    const none = runCli(["run", "--last"], root);
    expect(none.exitCode).toBe(1);
    expect(none.out).toContain(".bunsai/runs");
  });

  test("--last cannot be combined with --force or --from", () => {
    const forced = runCli(["run", "--last", "--force"], root);
    expect(forced.exitCode).toBe(1);
    expect(forced.out).toContain("--last");
    expect(forced.out).toContain("--force");
  });

  test("--last cannot be combined with --dry-run", () => {
    const bad = runCli(["run", "--last", "--dry-run"], root);
    expect(bad.exitCode).toBe(1);
    expect(bad.out).toContain("--dry-run");
  });

  test("post-run output renders the layered graph instead of a flat list", () => {
    writeFileSync(
      join(root, "bunsai.config.ts"),
      `export default {
  steps: [
    { name: "build", run: () => {} },
    { name: "deploy", dependsOn: ["build"], retries: 1, run: () => {} },
  ],
};
`
    );
    const run = runCli(["run"], root);
    expect(run.exitCode).toBe(0);
    expect(run.out).toContain("layers: 2 · 2 steps");
    expect(run.out).toContain("L1  └─ build");
    expect(run.out).toContain("L2  └─ deploy");
    expect(run.out).toContain("(1 attempt) ← build");
    expect(run.out).not.toContain("steps:");
    expect(run.out).toContain("2/2 steps succeeded");
  });

  test("--dry-run renders verdicts and executes nothing", () => {
    writeFileSync(
      join(root, "bunsai.config.ts"),
      `export default {
  steps: [
    {
      name: "materialize",
      run: (ctx) => {
        require("node:fs").writeFileSync(ctx.cwd + "/ran.txt", "executed");
      },
    },
    { name: "deploy", dependsOn: ["materialize"], retries: 2, run: () => {} },
  ],
};
`
    );
    const dry = runCli(["run", "--dry-run"], root);
    expect(dry.exitCode).toBe(0);
    expect(dry.out).toContain("layers: 2 · 2 steps");
    expect(dry.out).toContain("└─ deploy");
    expect(dry.out).toContain("run ← materialize · retries 2");
    expect(dry.out).toContain("dry-run: nothing executed");
    expect(existsSync(join(root, "ran.txt"))).toBe(false);
    expect(existsSync(join(root, ".bunsai"))).toBe(false);
  });

  test("--dry-run reads the cache state and honours --force", () => {
    writeFileSync(join(root, "bunsai.config.ts"), `export default { steps: [{ name: "build", run: () => {} }] };`);
    expect(runCli(["run"], root).exitCode).toBe(0);
    const dry = runCli(["run", "--dry-run"], root);
    expect(dry.exitCode).toBe(0);
    expect(dry.out).toContain("cached");
    const forced = runCli(["run", "--dry-run", "--force"], root);
    expect(forced.out).toContain("run (forced)");
    const from = runCli(["run", "--dry-run", "--from", "nope"], root);
    expect(from.exitCode).toBe(1);
    expect(from.out).toContain('--from step "nope" not found');
  });

  test("--help exits 0 and documents --from/--force", () => {
    const help = runCli(["run", "--help"], root);
    expect(help.exitCode).toBe(0);
    expect(help.out).toContain("--from");
    expect(help.out).toContain("--force");
    expect(help.out).toContain("--dry-run");
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
