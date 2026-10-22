import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PipelineState, StepRecord, StepStatus } from "../types.ts";

export type { PipelineState, StepRecord, StepStatus } from "../types.ts";

export function statePath(root: string): string {
  return join(root, ".bunsai", "state.json");
}

const STATUSES: StepStatus[] = ["success", "failure", "skipped"];

function isStepRecord(v: unknown): v is StepRecord {
  if (v === null || typeof v !== "object") return false;
  const rec = v as Record<string, unknown>;
  return (
    typeof rec.status === "string" &&
    (STATUSES as string[]).includes(rec.status) &&
    typeof rec.startedAt === "string" &&
    typeof rec.attempts === "number"
  );
}

/**
 * Load persisted state from <root>/.bunsai/state.json.
 * - No file (or unparseable JSON) → fresh empty state; nothing to resume from.
 * - Parseable but structurally invalid → throws with the file path so the user
 *   can inspect/delete it.
 */
export function loadState(root: string): PipelineState {
  const path = statePath(root);
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`bunsai: ${path} is not a valid state file (expected a JSON object) — delete it or run with --force`);
  }
  for (const [name, rec] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isStepRecord(rec)) {
      throw new Error(`bunsai: ${path} has an invalid record for step "${name}" — delete it or run with --force`);
    }
  }
  return parsed as PipelineState;
}

/** Persist state after each step, creating dirs as needed. */
export function saveState(root: string, state: PipelineState): void {
  const path = statePath(root);
  mkdirSync(join(root, ".bunsai"), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}
