import { describe, expect, test } from "bun:test";
import type { PipelineState, PipelineStep } from "../types.ts";
import { planPreview } from "./preview.ts";

const noop = () => {};

const steps: PipelineStep[] = [
  { name: "lint", run: noop },
  { name: "unit-test", run: noop },
  { name: "package", dependsOn: ["lint", "unit-test"], retries: 1, run: noop },
  { name: "deploy", dependsOn: ["package"], retries: 2, run: noop },
];
const names = ["lint", "unit-test", "package", "deploy"];
const hashes = new Map(names.map((n) => [n, "sha256:" + n]));

const state = (status: "success" | "failure", name: string): PipelineState => {
  const record = { status, startedAt: "2026-10-22T10:00:00.000Z", attempts: 1, inputHash: "sha256:" + name };
  return { [name]: record };
};

describe("planPreview", () => {
  test("groups steps into the same layers as topoLayers", () => {
    const plan = planPreview(steps, {}, hashes);
    expect(plan.layers).toEqual([["lint", "unit-test"], ["package"], ["deploy"]]);
    expect([...plan.entries.keys()]).toEqual(["lint", "unit-test", "package", "deploy"]);
    expect(plan.entries.get("deploy")!.retries).toBe(2);
  });

  test("reports cached, input-changed and no-record per step", () => {
    const prior: PipelineState = { ...state("success", "lint"), ...state("success", "unit-test") };
    // unit-test's recorded hash no longer matches the current one
    prior["unit-test"]!.inputHash = "sha256:stale";
    const plan = planPreview(steps, prior, hashes);
    expect(plan.entries.get("lint")).toMatchObject({ status: "cached", reason: "cached" });
    expect(plan.entries.get("unit-test")).toMatchObject({ status: "run", reason: "input-changed" });
    expect(plan.entries.get("package")).toMatchObject({ status: "run", reason: "no-record" });
  });

  test("--force turns every step into a forced run", () => {
    const prior: PipelineState = names.reduce((acc, n) => ({ ...acc, ...state("success", n) }), {});
    const plan = planPreview(steps, prior, hashes, { force: true });
    for (const name of names) {
      expect(plan.entries.get(name)).toMatchObject({ status: "run", reason: "forced" });
    }
  });

  test("--from reruns the target and its downstream only", () => {
    const prior: PipelineState = names.reduce((acc, n) => ({ ...acc, ...state("success", n) }), {});
    const plan = planPreview(steps, prior, hashes, { from: "package" });
    expect(plan.entries.get("lint")).toMatchObject({ status: "cached" });
    expect(plan.entries.get("unit-test")).toMatchObject({ status: "cached" });
    expect(plan.entries.get("package")).toMatchObject({ status: "run", reason: "forced" });
    expect(plan.entries.get("deploy")).toMatchObject({ status: "run", reason: "forced" });
  });

  test("an unknown --from names the missing step", () => {
    expect(() => planPreview(steps, {}, hashes, { from: "nope" })).toThrow(/--from step "nope" not found/);
  });
});
