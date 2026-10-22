import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StepStatus } from "../types.ts";

/** One step inside a run record. */
export interface RunStepRecord {
  name: string;
  status: StepStatus;
  attempts: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  /** true when the step was served from the cache instead of executing. */
  cached?: boolean;
  /** Cache key of the definition + declared inputs at execution time. */
  inputHash?: string;
  /** Absolute path of the step log, when one was written. */
  logPath?: string;
  error?: string;
}

/**
 * Per-run history, written to .bunsai/runs/<run-id>.json.
 * Kept separate from state.json: state is keyed by step name (cache source of
 * truth, one record per step) and cannot represent multiple runs.
 */
export interface RunRecordFile {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  ok?: boolean;
  cwd?: string;
  root?: string;
  steps: RunStepRecord[];
}

export const RUN_SCHEMA_VERSION = 1;

/**
 * Sortable, filesystem-safe run id: UTC <yyyymmdd>T<hhmmss><mmm>Z.
 * Lexicographic order equals chronological order, so the newest run is the
 * last *.json file in .bunsai/runs.
 */
export function newRunId(date: Date = new Date()): string {
  return date.toISOString().replace(/[-:.]/g, "");
}

export function runsDir(root: string): string {
  return join(root, ".bunsai", "runs");
}

export function runPath(root: string, runId: string): string {
  return join(runsDir(root), `${runId}.json`);
}

/** Write the full record (create parents), formatting stable for diffing. */
export function writeRunRecord(root: string, record: RunRecordFile): string {
  mkdirSync(runsDir(root), { recursive: true });
  const path = runPath(root, record.runId);
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
  return path;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read + shape-check one run record; failures name the file (plain Error). */
export function readRunRecord(path: string): RunRecordFile {
  if (!existsSync(path)) {
    throw new Error(`bunsai: no run record at ${path} — run \`bunsai run\` first`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`bunsai: ${path} is not a valid run record (unparseable JSON) — delete it`);
  }
  if (!isObject(parsed) || typeof parsed.runId !== "string" || !Array.isArray(parsed.steps)) {
    throw new Error(`bunsai: ${path} is not a valid run record (expected runId + steps) — delete it`);
  }
  return parsed as unknown as RunRecordFile;
}

/** Newest run record path by id, or undefined when no run has been recorded. */
export function latestRunPath(root: string): string | undefined {
  const dir = runsDir(root);
  if (!existsSync(dir)) return undefined;
  const ids = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
  const last = ids[ids.length - 1];
  return last === undefined ? undefined : runPath(root, last);
}

/** Last `count` lines of a text, without a trailing blank line artifact. */
export function tailLines(text: string, count: number): string {
  if (count <= 0) return "";
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines.length === 1 && lines[0] === "") return "";
  return lines.slice(-count).join("\n");
}
