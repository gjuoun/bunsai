#!/usr/bin/env bun
/**
 * check-structure.ts — structural gates for the code-tightening contract:
 *   - every *.ts under src/ is at most 300 lines;
 *   - the relative-import graph has no cycles.
 *
 * Usage: bun scripts/check-structure.ts   (exit 0 = structure-ok)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const MAX_LINES = 300;
const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const IMPORT_PATTERNS = [
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

function lineCount(text: string): number {
  if (text === "") return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

function relativeImports(file: string, text: string): string[] {
  const specs = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const spec = match[1];
      if (spec !== undefined && (spec.startsWith("./") || spec.startsWith("../"))) specs.add(spec);
    }
  }
  return [...specs]
    .map((spec) => resolveModule(file, spec))
    .filter((target): target is string => target !== undefined);
}

function resolveModule(file: string, spec: string): string | undefined {
  const base = resolve(dirname(file), spec);
  const candidates = [base, base + ".ts", join(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

const files = walk(SRC).sort();
const shown = (file: string) => relative(ROOT, file);
const failures: string[] = [];
let max = { file: "", lines: 0 };
const graph = new Map<string, string[]>();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = lineCount(text);
  if (lines > max.lines) max = { file: shown(file), lines };
  if (lines > MAX_LINES) failures.push(`FAIL lines ${shown(file)}: ${lines} (max ${MAX_LINES})`);
  graph.set(file, relativeImports(file, text));
}

const state = new Map<string, "visiting" | "done">();
const stack: string[] = [];

function visit(file: string): void {
  if (state.get(file) === "done") return;
  const mark = state.get(file);
  if (mark === "visiting") {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file].map(shown).join(" -> ");
    failures.push(`FAIL cycle: ${cycle}`);
    return;
  }
  state.set(file, "visiting");
  stack.push(file);
  for (const next of graph.get(file) ?? []) visit(next);
  stack.pop();
  state.set(file, "done");
}

for (const file of files) visit(file);

if (failures.length > 0) {
  for (const line of failures) console.log(line);
  process.exit(1);
}
console.log(`structure-ok: files=${files.length} max=${max.file}:${max.lines}`);