import { Context, Effect, Layer } from "effect";
import type { StepContext } from "../types.ts";
import { RunConfig } from "./run-config.ts";

export type ShellFn = StepContext["shell"];

export interface ShellRunnerShape {
  /** The Promise-based `ctx.shell` a step receives. */
  forStep(stepName: string): ShellFn;
}

export class ShellRunner extends Context.Tag("bunsai/ShellRunner")<ShellRunner, ShellRunnerShape>() {}

/**
 * Shell adapter as a service: run a command under `sh -c` via Bun.spawn with
 * inherited stdio (output streams live), using the cwd/env injected through
 * RunConfig. Returns the exit code on success; throws a plain Error naming the
 * step on non-zero exit so the runner's retry logic can pick it up.
 */
export class BunShellRunner implements ShellRunnerShape {
  constructor(
    private readonly cwd: string,
    private readonly env: Record<string, string | undefined>
  ) {}

  forStep(stepName: string): ShellFn {
    return (cmd: string): Promise<number> => this.run(stepName, cmd);
  }

  private async run(stepName: string, cmd: string): Promise<number> {
    const proc = Bun.spawn({
      cmd: ["sh", "-c", cmd],
      cwd: this.cwd,
      env: this.env,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`step "${stepName}" failed: command \`${cmd}\` exited with code ${code}`);
    }
    return code;
  }
}

export const shellRunnerLayer: Layer.Layer<ShellRunner, never, RunConfig> = Layer.effect(
  ShellRunner,
  Effect.map(RunConfig, (config) => new BunShellRunner(config.cwd, config.env))
);