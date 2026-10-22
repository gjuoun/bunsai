import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import type { RunOptions } from "../types.ts";
import { runConfigLayer } from "./run-config.ts";
import { ShellRunner, shellRunnerLayer } from "./shell-runner.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "bunsai-shell-runner-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const runner = async (options: RunOptions) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* ShellRunner;
    }).pipe(Effect.provide(shellRunnerLayer.pipe(Layer.provide(runConfigLayer(options)))))
  );

describe("BunShellRunner", () => {
  test("forStep returns the Promise-based ctx.shell contract", async () => {
    const shell = (await runner({ root })).forStep("ok-step");
    const result = shell("true");
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe(0);
  });

  test("non-zero exit rejects naming the step and the code", async () => {
    const shell = (await runner({ root })).forStep("bad-step");
    const error = await shell("exit 7").then(
      () => null,
      (e: Error) => e
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain('"bad-step"');
    expect(error!.message).toContain("7");
  });

  test("takes cwd and env from RunConfig", async () => {
    writeFileSync(join(root, "marker.txt"), "x");
    const shell = (await runner({ root, env: { ...process.env, BUNSAI_PROBE: "42" } })).forStep("cwd-step");
    expect(await shell("test -f marker.txt")).toBe(0);
    expect(await shell('test "$BUNSAI_PROBE" = 42')).toBe(0);
  });
});