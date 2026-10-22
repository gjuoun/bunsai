import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import type { OutputSink, RunOptions } from "../types.ts";
import { runConfigLayer } from "./run-config.ts";
import { ShellRunner, shellRunnerLayer } from "./shell-runner.ts";
import type { ShellRunnerShape } from "./shell-runner.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "bunsai-shell-runner-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const runner = async (options: RunOptions) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* ShellRunner;
    }).pipe(Effect.provide(shellRunnerLayer.pipe(Layer.provide(runConfigLayer(options)))))
  );

const collect = (): { sink: OutputSink; text: () => string } => {
  const chunks: Uint8Array[] = [];
  return {
    sink: (chunk) => chunks.push(chunk),
    text: () => new TextDecoder().decode(Buffer.concat(chunks)),
  };
};

const step = (runner: ShellRunnerShape, sink: OutputSink) => runner.forStep("tee-step", sink);

describe("BunShellRunner", () => {
  test("forStep returns the Promise-based ctx.shell contract and exits 0 on success", async () => {
    const shell = (await runner({ root })).forStep("ok-step");
    const result = shell("true");
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe(0);
  });

  test("non-zero exit rejects with the step name, the command, and the code", async () => {
    const shell = (await runner({ root })).forStep("bad-step");
    const error = await shell("exit 7").then(
      () => null,
      (e: Error) => e
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain('"bad-step"');
    expect(error!.message).toContain("exit 7");
    expect(error!.message).toContain("7");
  });

  test("runs in the cwd injected through RunConfig", async () => {
    writeFileSync(join(root, "marker.txt"), "x");
    const shell = (await runner({ root })).forStep("cwd-step");
    expect(await shell("test -f marker.txt")).toBe(0);
  });

  test("passes the env injected through RunConfig to the child process", async () => {
    const shell = (await runner({ root, env: { ...process.env, BUNSAI_PROBE: "42" } })).forStep("env-step");
    expect(await shell('test "$BUNSAI_PROBE" = 42')).toBe(0);
  });

  test("tees both streams into the sink while returning the exit code", async () => {
    const { sink, text } = collect();
    const code = await step(await runner({ root }), sink)("echo out-line; echo err-line 1>&2");
    expect(code).toBe(0);
    expect(text()).toContain("out-line");
    expect(text()).toContain("err-line");
  });

  test("a failing command still rejects and the sink holds its stderr", async () => {
    const { sink, text } = collect();
    const error = await step(await runner({ root }), sink)("echo boom 1>&2; exit 7").then(
      () => null,
      (e: Error) => e
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain("7");
    expect(text()).toContain("boom");
  });
});