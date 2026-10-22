/** Shared formatting primitives for every CLI renderer. */

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export const ICONS = { success: "✓", failure: "✗", skipped: "⤼" } as const;
