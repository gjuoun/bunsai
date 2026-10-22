import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeShell } from "./shell.ts";

let root: string;
test(() => {
  root = mkdtempSync(join(tmpdir(), "bunsai-shell-"));
});

describe("makeShell", () => {
  test("returns exit code 0 for a successful command", async () => {
    const shell = makeShell("ok-step", root, { ...process.env });
    expect(await shell("true")).toBe(0);
  });

  test("non-zero exit throws Error naming the step, command, and code", async () => {
    const shell = makeShell("bad-step", root, { ...process.env });
    const err = await shell("exit 7").then(
      () => null,
      (e: Error) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('"bad-step"');
    expect(err!.message).toContain("7");
    expect(err!.message).toContain("exit 7");
  });

  test("runs in the given cwd", async () => {
    writeFileSync(join(root, "marker.txt"), "x");
    const shell = makeShell("cwd-step", root, { ...process.env });
    expect(await shell("test -f marker.txt")).toBe(0);
  });

  test("passes env to the child process", async () => {
    const shell = makeShell("env-step", root, { ...process.env, BUNSAI_PROBE: "42" });
    expect(await shell('test "$BUNSAI_PROBE" = 42')).toBe(0);
  });
});

test(() => {
  rmSync(root, { recursive: true, force: true });
});
