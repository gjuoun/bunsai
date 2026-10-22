import type { PipelineStep } from "../types.ts";

/**
 * Layered topological sort of pipeline steps (Kahn's algorithm).
 * Steps in the same layer have no ordering between them and may run in parallel.
 *
 * Throws a plain Error with an actionable message on:
 * - duplicate step names
 * - dependencies on unknown steps
 * - dependency cycles (message lists every step stuck in the cycle)
 */
export function topoLayers<S extends { name: string; dependsOn?: string[] }>(steps: readonly S[]): string[][] {
  const byName = new Map<string, S>();
  for (const step of steps) {
    if (byName.has(step.name)) {
      throw new Error(`duplicate step name "${step.name}" — step names must be unique`);
    }
    byName.set(step.name, step);
  }

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const step of steps) {
    indegree.set(step.name, 0);
    dependents.set(step.name, []);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!byName.has(dep)) {
        throw new Error(`step "${step.name}" dependsOn unknown step "${dep}" — add a step named "${dep}" or fix the name`);
      }
      indegree.set(step.name, (indegree.get(step.name) ?? 0) + 1);
      dependents.get(dep)!.push(step.name);
    }
  }

  const layers: string[][] = [];
  let frontier = steps.filter((s) => (indegree.get(s.name) ?? 0) === 0).map((s) => s.name);
  let visited = 0;

  while (frontier.length > 0) {
    layers.push([...frontier]);
    visited += frontier.length;
    const next: string[] = [];
    for (const name of frontier) {
      for (const dependent of dependents.get(name)!) {
        const left = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, left);
        if (left === 0) next.push(dependent);
      }
    }
    frontier = next;
  }

  if (visited < steps.length) {
    const stuck = steps.map((s) => s.name).filter((n) => !layers.some((l) => l.includes(n)));
    throw new Error(
      `dependency cycle detected — these steps are stuck in a cycle (or depend on one): ${stuck.join(", ")}. Fix the dependsOn graph so it is acyclic.`
    );
  }

  return layers;
}
