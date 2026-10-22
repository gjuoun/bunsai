import { Context, Layer } from "effect";
import type { RunOptions } from "../types.ts";

export const DEFAULT_CONCURRENCY = 4;

/** Resolved run inputs, injected into the services that need them. */
export interface RunConfigShape {
  readonly root: string;
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly concurrency: number;
  readonly from: string | undefined;
  readonly force: boolean;
}

export class RunConfig extends Context.Tag("bunsai/RunConfig")<RunConfig, RunConfigShape>() {}

/** Apply the documented defaults once, in one place. */
export function resolveRunConfig(options: RunOptions): RunConfigShape {
  return {
    root: options.root,
    cwd: options.cwd ?? options.root,
    env: options.env ?? process.env,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    from: options.from,
    force: options.force ?? false,
  };
}

export const runConfigLayer = (options: RunOptions): Layer.Layer<RunConfig> =>
  Layer.succeed(RunConfig, resolveRunConfig(options));