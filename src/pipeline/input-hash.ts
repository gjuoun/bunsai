import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import type { PipelineStep } from "../types.ts";

const HASH_VERSION = 1;
const GLOB_MAGIC = /[*?[{]/;

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/**
 * Declared inputs, normalized without changing their meaning: trimmed,
 * empty entries dropped, duplicates removed, declaration order preserved.
 */
export function normalizeInputs(inputs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of inputs) {
    const trimmed = raw.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function isGlob(pattern: string): boolean {
  return GLOB_MAGIC.test(pattern);
}

/**
 * Resolve one declared input to the files it covers, relative to `cwd` and
 * sorted so the hash never depends on directory iteration order.
 * - glob: every matching file (empty when nothing matches);
 * - literal file: the file itself, or an empty list when it is missing;
 * - literal directory: a plain Error — declare a glob instead of guessing.
 */
export function expandInput(pattern: string, cwd: string): string[] {
  if (isGlob(pattern)) {
    const found = new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: true });
    return [...found].map(toPosix).sort();
  }
  const absolute = isAbsolute(pattern) ? pattern : resolve(cwd, pattern);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isFile()) {
    throw new Error(
      `step input "${pattern}" is a directory — declare a glob instead, e.g. "${pattern.replace(/\/+$/, "")}/**/*.ts"`
    );
  }
  return [toPosix(isAbsolute(pattern) ? pattern : pattern.replace(/^\.\//, ""))];
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/**
 * Cache key for one step: the step definition plus the *content* of every
 * declared input.
 *
 * Honest limits (documented in the README): what the `run` closure captures is
 * not observable, so a step that declares no inputs hashes only its config, and
 * file bytes — not mtimes — are hashed.
 */
export function hashStep(step: PipelineStep, cwd: string): string {
  const inputs = normalizeInputs(step.inputs ?? []);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(
    JSON.stringify({
      v: HASH_VERSION,
      name: step.name,
      dependsOn: [...(step.dependsOn ?? [])].sort(),
      retries: step.retries ?? 0,
      inputs,
    })
  );

  for (const pattern of inputs) {
    hasher.update(`\u0000input\u0000${pattern}`);
    const files = expandInput(pattern, cwd);
    if (files.length === 0) {
      hasher.update(isGlob(pattern) ? "\u0000empty\u0000" : "\u0000missing\u0000");
      continue;
    }
    for (const file of files) {
      hasher.update(`\u0000file\u0000${file}\u0000`);
      hasher.update(sha256(readFileSync(resolve(cwd, file))));
    }
  }
  return `sha256:${hasher.digest("hex")}`;
}
