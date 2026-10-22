/** bunsai pipeline types — CI/CD in code, not YAML. */

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

/**
 * Context handed to every step's `run`.
 * `shell` runs a command via Bun.spawn with inherited stdio, returns the exit
 * code on success, and throws an Error naming the failing step on non-zero exit.
 */
export interface StepContext {
  cwd: string;
  env: Record<string, string>;
  logger: Logger;
  shell(cmd: string): Promise<number>;
}

export interface PipelineStep {
  name: string;
  /** Names of steps that must succeed before this step runs. */
  dependsOn?: string[];
  /** Extra attempts after the first failure. Default 0. Exponential backoff. */
  retries?: number;
  run(ctx: StepContext): void | Promise<void>;
}

export interface Pipeline {
  steps: PipelineStep[];
}

export interface RunOptions {
  /** Pipeline root: state lives in <root>/.bunsai/state.json. */
  root: string;
  /** Working directory for steps (default: root). */
  cwd?: string;
  /** Environment passed to steps and ctx.shell (default: process.env). */
  env?: Record<string, string | undefined>;
  logger?: Logger;
  /** Max parallel steps via Effect Semaphore (default: 4). */
  concurrency?: number;
  /** Rerun this step and everything downstream of it. */
  from?: string;
  /** Ignore cached state; rerun every step. */
  force?: boolean;
}

export interface StepOutcome {
  name: string;
  status: "success" | "failure" | "skipped";
  attempts: number;
  durationMs?: number;
  cached?: boolean;
  error?: string;
}

export interface RunResult {
  ok: boolean;
  steps: StepOutcome[];
  totalMs: number;
}

export type StepStatus = "success" | "failure" | "skipped";

export interface StepRecord {
  status: StepStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  attempts: number;
  /** wall-clock duration in ms, derived from startedAt/endedAt */
  durationMs?: number;
}

/** Persisted run state: stepName -> last outcome. Written to .bunsai/state.json. */
export interface PipelineState {
  [stepName: string]: StepRecord;
}