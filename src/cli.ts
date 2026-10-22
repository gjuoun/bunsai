#!/usr/bin/env bun
/**
 * bunsai bin. The @effect/cli program is imported only when this file actually
 * runs, so importing bunsai (or its core entry) never pulls the CLI into memory.
 * Gate: `bun scripts/check-lazy.ts`.
 */
if (import.meta.main) {
  const { main } = await import("./cli/program.ts");
  process.exitCode = await main(process.argv);
}