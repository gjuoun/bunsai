import { readFileSync } from "node:fs";
import type { RunStepRecord } from "../services/run-record.ts";
import { latestRunPath, readRunRecord, tailLines } from "../services/run-record.ts";
import { formatMs, renderStepLine } from "./render.ts";

const TAIL_LINES = 40;

/**
 * `bunsai run --last`: report the newest recorded run and tail every failed
 * step's log. Read-only — no step executes.
 */
export function executeLast(root: string): number {
  const path = latestRunPath(root);
  if (path === undefined) {
    console.error("bunsai: no runs recorded in .bunsai/runs — run `bunsai run` first");
    return 1;
  }
  const record = readRunRecord(path);
  const total = record.durationMs !== undefined ? ` [${formatMs(record.durationMs)}]` : "";
  console.log("");
  console.log(`run ${record.runId} — ${record.startedAt}${total}`);
  console.log("steps:");
  for (const step of record.steps) console.log("  " + renderStepLine(step));

  const failed = record.steps.filter((s) => s.status === "failure");
  const ok = record.ok === true && failed.length === 0;
  console.log("");
  if (ok) console.log("✓ run succeeded");
  else if (failed.length > 0) console.log(`✗ run failed — ${failed.length} step(s) failed`);
  else console.log("✗ run did not finish cleanly (incomplete record)");

  for (const step of failed) tailStepLog(step);
  return 0;
}

function tailStepLog(step: RunStepRecord): void {
  if (step.logPath === undefined) {
    console.log(`\n--- ${step.name}: no log recorded ---`);
    return;
  }
  console.log(`\n--- ${step.logPath} (last ${TAIL_LINES} lines) ---`);
  try {
    console.log(tailLines(readFileSync(step.logPath, "utf8"), TAIL_LINES));
  } catch {
    console.log(`(log file missing: ${step.logPath})`);
  }
}
