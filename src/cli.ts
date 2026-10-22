#!/usr/bin/env bun
/**
 * bunsai CLI — `bunsai run [--from <step>] [--force]`.
 * Loads ./bunsai.config.ts from the cwd, runs the pipeline, prints per-step
 * timing and a final summary. Exit code 0 on success, 1 on failure.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "./runner.ts";
import type { Pipeline } from "./types.ts";

export interface CliArgs {
  command: string;
  from?: string;
  force: boolean;
}

const USAGE = 'usage: bunsai run [--from <step>] [--force]';

/** Parse CLI arguments by hand — bunsai needs no argument-parsing dependency. */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: "", force: false };
  const rest = [...argv];
  if (rest.length === 0) {
    throw new Error(`${USAGE}\n(no command given — only "run" is implemented in 0.1)`);
  }
  const command = rest.shift()!;
  if (command !== "run") {
    throw new Error(`unknown command "${command}"\n${USAGE}`);
  }
  args.command = command;

  while (rest.length > 0) {
    const arg = rest.shift()!;
    if (arg === "--force") {
      args.force = true;
    } else if (arg === "--from") {
      const value = rest.shift();
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`--from requires a step name, e.g. --from build\n${USAGE}`);
      }
      args.from = value;
    } else if (arg.startsWith("--from=")) {
      const value = arg.slice("--from=".length);
      if (value.length === 0) {
        throw new Error(`--from requires a step name, e.g. --from=build\n${USAGE}`);
      }
      args.from = value;
    } else {
      throw new Error(`unknown flag "${arg}"\n${USAGE}`);
    }
  }
  return args;
}

/** Load and validate <cwd>/bunsai.config.ts (default export or named `pipeline`). */
export async function loadPipeline(cwd: string): Promise<Pipeline> {
  const configPath = join(cwd, "bunsai.config.ts");
  if (!existsSync(configPath)) {
    throw new Error(
      `bunsai: no bunsai.config.ts found in ${cwd}. Create one exporting a pipeline, e.g.\n` +
        "  import { definePipeline } from \"bunsai\";\n" +
        "  export default definePipeline({ steps: [{ name: \"build\", run: (ctx) => ctx.shell(\"make build\") }] });\n" +
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

export async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const cwd = process.cwd();
  try {
    const pipeline = await loadPipeline(cwd);
    const result = await runPipeline(pipeline, { root: cwd, from: args.from, force: args.force });

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

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
