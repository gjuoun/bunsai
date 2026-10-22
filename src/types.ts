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

/**
 * Receives each chunk of a step's output for logging while the chunk is
 * written live to the terminal (tee, never buffer-then-print).
 */
export type OutputSink = (chunk: Uint8Array) => void;

export interface PipelineStep {
  name: string;
  /** Names of steps that must succeed before this step runs. */
  dependsOn?: string[];
  /** Extra attempts after the first failure. Default 0. Exponential backoff. */
  retries?: number;
  /**
   * Files this step reads, as paths or globs relative to the step's cwd.
   * They are part of the cache key: success + an unchanged hash skips the step.
   * Declaring none hashes only the step config (what a `run` closure captures
   * is not observable — see README).
   */
  inputs?: string[];
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
  /**
   * Cache key of the definition + declared inputs at the time of this record
   * (`sha256:…`). Absent in pre-0.2 state, which therefore always reruns.
   */
  inputHash?: string;
}

/** Persisted run state: stepName -> last outcome. Written to .bunsai/state.json. */
export interface PipelineState {
  [stepName: string]: StepRecord;
}