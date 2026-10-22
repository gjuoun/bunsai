#!/usr/bin/env bun
/**
 * bunsai CLI — `bunsai run [--from <step>] [--force]`.
 * Argument parsing is @effect/cli (typed options, --help, wizard-ready);
 * platform services come from @effect/platform-bun.
 * Loads ./bunsai.config.ts from the cwd, runs the pipeline, prints per-step
 * timing and a final summary. Exit code 0 on success, 1 on failure.
 */
import { CliConfig, Command, Options } from "@effect/cli";
import { BunContext } from "@effect/platform-bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { runPipeline } from "./runner.ts";
import type { Pipeline } from "./types.ts";

/** Load and validate <cwd>/bunsai.config.ts (default export or named `pipeline`). */
export async function loadPipeline(cwd: string): Promise<Pipeline> {
  const configPath = join(cwd, "bunsai.config.ts");
  if (!existsSync(configPath)) {
    throw new Error(
      `bunsai: no bunsai.config.ts found in ${cwd}. Create one exporting a pipeline, e.g.\n` +
        '  import { definePipeline } from "bunsai";\n' +
        '  export default definePipeline({ steps: [{ name: "build", run: (ctx) => ctx.shell("make build") }] });\n' +
        "See examples/bunsai.config.ts for a fuller demo."
    );
  }
  const mod = (await import(configPath)) as { default?: unknown; pipeline?: unknown };
  const config = mod.default ?? mod.pipeline;
  if (config === undefined || typeof config !== "object" || !Array.isArray((config as { steps?: unknown }).steps)) {
    throw new Error(
      `bunsai: ${configPath} must export a pipeline (default export or named \`pipeline\`) with a non-empty "steps" array — wrap it in definePipeline({ steps: [...] })`
    );
  }
  return config as Pipeline;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const ICONS = { success: "✓", failure: "✗", skipped: "⤼" } as const;

/** Execute the `run` command and return the process exit code. */
export async function executeRun(from: string | undefined, force: boolean): Promise<number> {
  const cwd = process.cwd();
  try {
    const pipeline = await loadPipeline(cwd);
    const result = await runPipeline(pipeline, { root: cwd, from, force });

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
    return result.ok ? 0 : 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const runCommand = Command.make(
  "run",
  {
    from: Options.optional(
      Options.text("from").pipe(Options.withDescription("rerun this step and everything downstream of it"))
    ),
    force: Options.boolean("force").pipe(Options.withDescription("ignore the cache and rerun all steps")),
  },
  ({ from, force }) =>
    Effect.promise(async () => {
      process.exitCode = await executeRun(Option.isSome(from) ? from.value : undefined, force);
    })
);

const rootCommand = Command.make("bunsai", {}, () => Effect.void).pipe(Command.withSubcommands([runCommand]));

export const cli = Command.run(rootCommand, {
  name: "bunsai",
  version: "0.1.0",
});

if (import.meta.main) {
  await Effect.runPromise(
    cli(process.argv).pipe(
      Effect.provide(BunContext.layer),
      Effect.provide(CliConfig.layer())
    )
  ).catch((err: unknown) => {
    // ValidationError from @effect/cli already renders usage; anything else gets a plain message
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exitCode = 1;
  });
}
