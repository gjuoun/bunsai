#!/usr/bin/env bun
/**
 * check-lazy.ts — import-graph gate for per-module lazy loading.
 *
 * Proves three things by bundling with splitting enabled (Bun.build keeps
 * static imports in the entry chunk and turns `await import()` into a deferred
 * chunk):
 *
 *   1. the core entry (`src/index.ts`) pulls no `@effect/cli`, no
 *      `@effect/platform-bun`, and no `examples/` code;
 *   2. the bin (`src/cli.ts`) is a thin bootstrap: entry chunk < 2 KB, no
 *      `@effect/cli`, at least one dynamic `import(...)`;
 *   3. the CLI program (`src/cli/program.ts`) DOES bundle `@effect/cli` — a
 *      positive control so the greps above cannot pass vacuously.
 *
 * Usage: bun scripts/check-lazy.ts   (exit 0 = lazy-ok, exit 1 = FAIL lines)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PACKAGES = ["@effect/cli", "@effect/platform-bun"] as const;
const MAX_BOOT_BYTES = 2_048;
const DYNAMIC_IMPORT = /import\s*\(\s*["'`]/;

interface Built {
  readonly ok: boolean;
  readonly text?: string;
  readonly chunks: number;
  readonly error?: string;
}

const failures: string[] = [];
const scratch = mkdtempSync(join(tmpdir(), "bunsai-lazy-"));

async function build(entry: string, name: string): Promise<Built> {
  try {
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: join(scratch, name),
      target: "bun",
      format: "esm",
      splitting: true,
    });
    if (!result.success) {
      const logs = result.logs.map((l) => l.message).join("; ");
      return { ok: false, chunks: result.outputs.length, error: logs || "build failed" };
    }
    const entryOutput = result.outputs.find((o) => o.kind === "entry-point");
    if (entryOutput === undefined) return { ok: false, chunks: result.outputs.length, error: "no entry-point output" };
    return { ok: true, text: await Bun.file(entryOutput.path).text(), chunks: result.outputs.length };
  } catch (err) {
    return { ok: false, chunks: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

const core = await build("src/index.ts", "core");
if (!core.ok) {
  failures.push("FAIL src/index.ts: build failed — " + core.error);
} else {
  const text = core.text ?? "";
  const leaked = CLI_PACKAGES.filter((p) => text.includes(p));
  if (leaked.length > 0) failures.push("FAIL src/index.ts: core entry bundles " + leaked.join(", "));
  if (/examples\//.test(text)) failures.push("FAIL src/index.ts: core entry pulls example-only code");
}

const boot = await build("src/cli.ts", "boot");
if (!boot.ok) {
  failures.push("FAIL src/cli.ts: build failed — " + boot.error);
} else {
  const text = boot.text ?? "";
  if (text.length >= MAX_BOOT_BYTES) {
    failures.push("FAIL src/cli.ts: bootstrap chunk is " + text.length + " bytes (must stay under " + MAX_BOOT_BYTES + ")");
  } else if (CLI_PACKAGES.some((p) => text.includes(p))) {
    failures.push("FAIL src/cli.ts: bootstrap bundles the CLI program eagerly");
  } else if (!DYNAMIC_IMPORT.test(text)) {
    failures.push("FAIL src/cli.ts: bootstrap has no dynamic import(...) seam");
  }
}

const program = await build("src/cli/program.ts", "program");
if (!program.ok) {
  failures.push("FAIL src/cli/program.ts: build failed — " + program.error);
} else if (!(program.text ?? "").includes("@effect/cli")) {
  failures.push("FAIL src/cli/program.ts: positive control missing — bundle has no @effect/cli");
}

rmSync(scratch, { recursive: true, force: true });

if (failures.length > 0) {
  for (const line of failures) console.log(line);
  process.exit(1);
}
console.log("lazy-ok: core=" + (core.text ?? "").length + "B boot=" + (boot.text ?? "").length + "B chunks=" + boot.chunks);