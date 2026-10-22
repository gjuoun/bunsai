/**
 * bunsai — public entry point.
 *
 * Deliberately CLI-free: importing this module must not pull `@effect/cli` or
 * any example-only code into memory. The bin lives in `src/cli.ts`, which
 * loads its command tree lazily (see `scripts/check-lazy.ts`).
 */
export * from "./types.ts";
export { definePipeline } from "./pipeline/define-pipeline.ts";
export { runPipeline } from "./runner.ts";