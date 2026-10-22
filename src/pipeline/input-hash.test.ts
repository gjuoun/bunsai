import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineStep } from "../types.ts";
import { expandInput, hashStep, normalizeInputs } from "./input-hash.ts";

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "bunsai-hash-"));
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(cwd, "src/b.ts"), "export const b = 2;\n");
  writeFileSync(join(cwd, "notes.md"), "# notes\n");
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const step = (extra: Partial<PipelineStep> = {}): PipelineStep => ({
  name: "build",
  run: () => {},
  ...extra,
});

describe("hashStep", () => {
  test("is stable across calls and carries the sha256: prefix", () => {
    const a = hashStep(step({ inputs: ["src/a.ts"] }), cwd);
    const b = hashStep(step({ inputs: ["src/a.ts"] }), cwd);
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
  });

  test("changes when a declared file content changes", () => {
    const before = hashStep(step({ inputs: ["src/a.ts"] }), cwd);
    writeFileSync(join(cwd, "src/a.ts"), "export const a = 111;\n");
    expect(hashStep(step({ inputs: ["src/a.ts"] }), cwd)).not.toBe(before);
  });

  test("changes when a glob gains a matching file", () => {
    const before = hashStep(step({ inputs: ["src/**/*.ts"] }), cwd);
    writeFileSync(join(cwd, "src/c.ts"), "export const c = 3;\n");
    expect(hashStep(step({ inputs: ["src/**/*.ts"] }), cwd)).not.toBe(before);
  });

  test("changes when a glob loses a matching file", () => {
    const before = hashStep(step({ inputs: ["src/**/*.ts"] }), cwd);
    rmSync(join(cwd, "src/b.ts"));
    expect(hashStep(step({ inputs: ["src/**/*.ts"] }), cwd)).not.toBe(before);
  });

  test("missing literal input hashes as missing, then changes when created", () => {
    const before = hashStep(step({ inputs: ["generated.ts"] }), cwd);
    expect(hashStep(step({ inputs: ["generated.ts"] }), cwd)).toBe(before);
    writeFileSync(join(cwd, "generated.ts"), "x\n");
    expect(hashStep(step({ inputs: ["generated.ts"] }), cwd)).not.toBe(before);
  });

  test("without declared inputs only the config is hashed", () => {
    const before = hashStep(step(), cwd);
    writeFileSync(join(cwd, "src/a.ts"), "changed\n");
    expect(hashStep(step(), cwd)).toBe(before);
    expect(hashStep(step({ retries: 2 }), cwd)).not.toBe(before);
  });

  test("dependsOn declaration order does not change the hash", () => {
    const ab = hashStep(step({ dependsOn: ["a", "b"] }), cwd);
    const ba = hashStep(step({ dependsOn: ["b", "a"] }), cwd);
    expect(ab).toBe(ba);
  });

  test("a literal directory is rejected with an actionable message", () => {
    expect(() => expandInput("src", cwd)).toThrow(/directory/);
    expect(() => expandInput("src/", cwd)).toThrow(/src\/\*\*/);
  });
});

describe("normalizeInputs", () => {
  test("trims, drops empties, removes duplicates, keeps order", () => {
    expect(normalizeInputs([" b.ts", "", "a.ts", "b.ts "])).toEqual(["b.ts", "a.ts"]);
  });
});
