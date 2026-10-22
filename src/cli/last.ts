import { readFileSync } from "node:fs";
import { topoLayers } from "../pipeline/scheduler.ts";
import type { RunRecordFile, RunStepRecord } from "../services/run-record.ts";
import { RUN_SCHEMA_VERSION, latestRunPath, readRunRecord, tailLines } from "../services/run-record.ts";
import { renderResultGraph } from "./graph-render.ts";
import type { ResultStepView } from "./graph-render.ts";
import { formatMs } from "./render.ts";

const TAIL_LINES = 40;

/**
 * `bunsai run --last`: report the newest recorded run, its layered graph, and
 * tail every failed step's log. Read-only — no step executes.
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
  printGraph(record);

  const failed = record.steps.filter((s) => s.status === "failure");
  const ok = record.ok === true && failed.length === 0;
  console.log("");
  if (ok) console.log("✓ run succeeded");
  else if (failed.length > 0) console.log(`✗ run failed — ${failed.length} step(s) failed`);
  else console.log("✗ run did not finish cleanly (incomplete record)");

  for (const step of failed) tailStepLog(step);
  return 0;
}

function viewOf(step: RunStepRecord): ResultStepView {
  return {
    status: step.status,
    cached: step.cached,
    attempts: step.attempts,
    durationMs: step.durationMs,
    dependsOn: step.dependsOn,
  };
}

/**
 * Layers come from the record's own `dependsOn` edges, so no config load is
 * needed. A record written before 0.2.5 carries no edges: every step is shown
 * as one unordered group, labelled instead of guessed.
 */
function printGraph(record: RunRecordFile): void {
  const views = new Map(record.steps.map((step) => [step.name, viewOf(step)]));
  if (record.schemaVersion < RUN_SCHEMA_VERSION) {
    console.log("order unknown (record written before dependency edges were recorded)");
    for (const line of renderResultGraph([record.steps.map((step) => step.name)], views)) console.log(line);
    return;
  }
  try {
    for (const line of renderResultGraph(topoLayers(record.steps), views)) console.log(line);
  } catch (err) {
    console.log(`graph incomplete: ${err instanceof Error ? err.message : String(err)}`);
    for (const line of renderResultGraph([record.steps.map((step) => step.name)], views)) console.log(line);
  }
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
