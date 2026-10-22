import type { PipelineStep } from "../../types.ts";

export const RETRY_BASE_MS = 50;
export const RETRY_CAP_MS = 2_000;

/** Step names that transitively depend on `target` (target included). */
export function downstreamOf(steps: PipelineStep[], target: string): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), step.name]);
    }
  }
  const closure = new Set<string>([target]);
  const queue = [target];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const dependent of dependents.get(current) ?? []) {
      if (!closure.has(dependent)) {
        closure.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return closure;
}

/** Exponential backoff: 50ms, 100ms, 200ms … capped at 2s. */
export function backoffMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS);
}