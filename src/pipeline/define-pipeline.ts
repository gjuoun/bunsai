import type { Pipeline } from "../types.ts";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Identity function that validates the pipeline shape and locks in the type.
 * Throws a plain Error with an actionable message on bad input.
 */
export function definePipeline(pipeline: Pipeline): Pipeline {
  if (pipeline === null || typeof pipeline !== "object") {
    throw new Error("definePipeline: expected an object like { steps: [...] }, got " + typeof pipeline);
  }
  if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) {
    throw new Error('definePipeline: "steps" must be a non-empty array — add at least one step, e.g. { name: "build", run: (ctx) => ctx.shell("...") }');
  }
  for (const step of pipeline.steps) {
    if (step === null || typeof step !== "object") {
      throw new Error("definePipeline: every step must be an object, got " + String(step));
    }
    if (!isNonEmptyString(step.name)) {
      throw new Error("definePipeline: every step needs a non-empty string \"name\", got " + JSON.stringify(step.name));
    }
    if (typeof step.run !== "function") {
      throw new Error(`definePipeline: step "${step.name}" needs a "run(ctx)" function`);
    }
    if (step.retries !== undefined && (typeof step.retries !== "number" || !Number.isInteger(step.retries) || step.retries < 0)) {
      throw new Error(`definePipeline: step "${step.name}" has invalid retries ${JSON.stringify(step.retries)} — use a non-negative integer`);
    }
    if (step.dependsOn !== undefined) {
      if (!Array.isArray(step.dependsOn) || step.dependsOn.some((d) => !isNonEmptyString(d))) {
        throw new Error(`definePipeline: step "${step.name}" has invalid dependsOn ${JSON.stringify(step.dependsOn)} — use an array of step names`);
      }
    }
  }
  return pipeline;
}