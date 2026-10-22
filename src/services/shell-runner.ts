import { Context, Effect, Layer } from "effect";
import type { StepContext } from "../types.ts";
import { RunConfig } from "./run-config.ts";
import { makeShell } from "./shell.ts";

export type ShellFn = StepContext["shell"];

export interface ShellRunnerShape {
  /** The Promise-based `ctx.shell` a step receives. */
  forStep(stepName: string): ShellFn;
}

/**
 * Shell adapter as a service. Dependencies (cwd, env) are injected through
 * RunConfig at layer construction, never read from globals here.
 */
export class ShellRunner extends Context.Tag("bunsai/ShellRunner")<ShellRunner, ShellRunnerShape>() {}

export class BunShellRunner implements ShellRunnerShape {
  constructor(
    private readonly cwd: string,
    private readonly env: Record<string, string | undefined>
  ) {}

  forStep(stepName: string): ShellFn {
    return makeShell(stepName, this.cwd, this.env);
  }
}

export const shellRunnerLayer: Layer.Layer<ShellRunner, never, RunConfig> = Layer.effect(
  ShellRunner,
  Effect.map(RunConfig, (config) => new BunShellRunner(config.cwd, config.env))
);