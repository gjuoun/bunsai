import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { definePipeline } from "../src/types.ts";

/**
 * Demo pipeline for bunsai 0.1 — run it from this directory:
 *
 *   bun ../src/cli.ts run            # first run: everything executes
 *   bun ../src/cli.ts run            # rerun: successful steps are served from cache
 *   bun ../src/cli.ts run --from package   # force a step + its downstream to rerun
 *   bun ../src/cli.ts run --force    # rerun everything
 *
 * Shape: two parallel steps → one step depending on both → a flaky step that
 * fails on its first attempt and succeeds on retry (retries: 2).
 */
export default definePipeline({
  steps: [
    {
      name: "lint",
      run: async (ctx) => {
        ctx.logger.info("linting (pretend eslint) in " + ctx.cwd);
        await ctx.shell("sh -c 'echo lint: 0 problems'");
      },
    },
    {
      name: "unit-test",
      run: async (ctx) => {
        ctx.logger.info("running unit tests (pretend) in " + ctx.cwd);
        await ctx.shell("sh -c 'echo unit-test: 42 passed'");
      },
    },
    {
      name: "package",
      dependsOn: ["lint", "unit-test"],
      run: async (ctx) => {
        ctx.logger.info("both parallel steps done — packaging");
        await ctx.shell("sh -c 'echo package: artifact.tar.gz'");
      },
    },
    {
      name: "deploy-dry-run",
      dependsOn: ["package"],
      retries: 2,
      run: (ctx) => {
        // Flaky by design: fails until a marker file exists, succeeds after.
        // Delete examples/.bunsai/flaky.marker to make it flaky again.
        const marker = join(ctx.cwd, ".bunsai", "flaky.marker");
        if (existsSync(marker)) {
          ctx.logger.info("flaky step: marker found, deploying dry-run OK");
          return;
        }
        mkdirSync(join(ctx.cwd, ".bunsai"), { recursive: true });
        writeFileSync(marker, "first attempt only\n");
        throw new Error("simulated transient failure — retry will succeed (marker written)");
      },
    },
  ],
});
