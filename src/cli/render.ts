import type { RunResult } from "../types.ts";

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const ICONS = { success: "✓", failure: "✗", skipped: "⤼" } as const;

/** Per-step timing block + final summary. Output text is part of the freeze. */
export function renderRunResult(result: RunResult): void {
  console.log("");
  console.log("steps:");
  for (const step of result.steps) {
    const icon = ICONS[step.status];
    const cached = step.cached ? " (cached)" : "";
    const time = step.durationMs !== undefined ? ` [${formatMs(step.durationMs)}]` : "";
    const attempts = step.status === "skipped" ? "" : ` (${step.attempts} attempt${step.attempts === 1 ? "" : "s"})`;
    console.log(`  ${icon} ${step.name}${cached}${time}${attempts}`);
  }
  const done = result.steps.filter((s) => s.status === "success").length;
  const total = result.steps.length;
  console.log("");
  console.log(`total: ${formatMs(result.totalMs)}`);
  console.log(
    result.ok
      ? `✓ ${done}/${total} steps succeeded`
      : `✗ pipeline failed — fix the failing step and rerun (already-successful steps are skipped; \`--from <step>\` forces a step and its downstream to rerun)`
  );
}