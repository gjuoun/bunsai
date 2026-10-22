import { describe, expect, test } from "bun:test";
import { renderPlanGraph, renderResultGraph } from "./graph-render.ts";
import type { StepPlan } from "../pipeline/preview.ts";
import type { ResultStepView } from "./graph-render.ts";

const layers = [["lint", "unit-test"], ["package"], ["deploy-dry-run"]];

const plan: StepPlan = {
  layers,
  entries: new Map([
    ["lint", { name: "lint", status: "run", reason: "no-record", dependsOn: [], retries: 0 }],
    ["unit-test", { name: "unit-test", status: "cached", reason: "cached", dependsOn: [], retries: 0 }],
    [
      "package",
      { name: "package", status: "run", reason: "input-changed", dependsOn: ["lint", "unit-test"], retries: 0 },
    ],
    [
      "deploy-dry-run",
      { name: "deploy-dry-run", status: "run", reason: "forced", dependsOn: ["package"], retries: 2 },
    ],
  ]),
};

describe("renderPlanGraph", () => {
  test("renders topological layers with verdicts, deps and retries", () => {
    expect(renderPlanGraph(plan)).toEqual([
      "layers: 3 · 4 steps",
      "  L1  ├─ lint            run",
      "      └─ unit-test       cached",
      "  L2  └─ package         run (input changed) ← lint, unit-test",
      "  L3  └─ deploy-dry-run  run (forced) ← package · retries 2",
    ]);
  });
});

describe("renderResultGraph", () => {
  const views = new Map<string, ResultStepView>([
    ["lint", { status: "success", attempts: 1, durationMs: 120, dependsOn: [] }],
    ["unit-test", { status: "skipped", cached: true, attempts: 1, dependsOn: [] }],
    ["package", { status: "failure", attempts: 2, durationMs: 2100, dependsOn: ["lint", "unit-test"] }],
    ["deploy-dry-run", { status: "skipped", attempts: 0, dependsOn: ["package"] }],
  ]);

  test("marks success, cached, failure and blocked steps", () => {
    expect(renderResultGraph(layers, views)).toEqual([
      "layers: 3 · 4 steps",
      "  L1  ├─ lint            ✓ [120ms] (1 attempt)",
      "      └─ unit-test       ⤼ (cached)",
      "  L2  └─ package         ✗ [2.1s] (2 attempts) ← lint, unit-test",
      "  L3  └─ deploy-dry-run  ⤼ (blocked) ← package",
    ]);
  });

  test("names a step the record does not contain instead of throwing", () => {
    const partial = new Map(views);
    partial.delete("lint");
    expect(renderResultGraph(layers, partial)[1]).toBe("  L1  ├─ lint            ? (missing from the run record)");
  });
});
