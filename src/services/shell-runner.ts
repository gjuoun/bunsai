import { Context, Effect, Layer } from "effect";
import type { OutputSink, StepContext } from "../types.ts";
import { RunConfig } from "./run-config.ts";

export type ShellFn = StepContext["shell"];

export interface ShellRunnerShape {
  /**
   * The Promise-based `ctx.shell` a step receives. With a sink, stdout and
   * stderr are piped, written live to the terminal, and teed into the sink.
   */
  forStep(stepName: string, sink?: OutputSink): ShellFn;
}

export class ShellRunner extends Context.Tag("bunsai/ShellRunner")<ShellRunner, ShellRunnerShape>() {}

async function pump(
  stream: ReadableStream<Uint8Array>,
  terminal: NodeJS.WriteStream,
  sink: OutputSink
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        terminal.write(value);
        sink(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Shell adapter as a service: run a command under `sh -c` via Bun.spawn, using
 * the cwd/env injected through RunConfig. Without a sink stdio is inherited
 * (0.1 behavior); with one, both streams are pumped to the terminal and the
 * sink as they arrive. Returns the exit code on success; throws a plain Error
 * naming the step on non-zero exit so the runner's retry logic can pick it up.
 */
export class BunShellRunner implements ShellRunnerShape {
  constructor(
    private readonly cwd: string,
    private readonly env: Record<string, string | undefined>
  ) {}

  forStep(stepName: string, sink?: OutputSink): ShellFn {
    return (cmd: string): Promise<number> => this.run(stepName, cmd, sink);
  }

  private async run(stepName: string, cmd: string, sink?: OutputSink): Promise<number> {
    if (sink === undefined) {
      const proc = Bun.spawn({
        cmd: ["sh", "-c", cmd],
        cwd: this.cwd,
        env: this.env,
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      return this.check(stepName, cmd, code);
    }

    const proc = Bun.spawn({
      cmd: ["sh", "-c", cmd],
      cwd: this.cwd,
      env: this.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const tee = sink;
    const pumps = Promise.all([
      pump(proc.stdout, process.stdout, tee),
      pump(proc.stderr, process.stderr, tee),
    ]);
    const code = await proc.exited;
    await pumps;
    return this.check(stepName, cmd, code);
  }

  private check(stepName: string, cmd: string, code: number): number {
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
