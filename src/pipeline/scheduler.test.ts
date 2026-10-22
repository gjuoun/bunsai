import { describe, expect, test } from "bun:test";
import { topoLayers } from "./scheduler.ts";
import type { PipelineStep } from "../types.ts";

const step = (name: string, dependsOn?: string[]): PipelineStep => ({ name, dependsOn, run: () => {} });

describe("topoLayers", () => {
  test("orders a diamond DAG into correct layers", () => {
    const layers = topoLayers([step("build"), step("lint"), step("test", ["build"]), step("deploy", ["lint", "test"])]);
    expect(layers).toEqual([["build", "lint"], ["test"], ["deploy"]]);
  });

  test("single chain is fully sequential", () => {
    expect(topoLayers([step("a"), step("b", ["a"]), step("c", ["b"])])).toEqual([["a"], ["b"], ["c"]]);
  });

  test("rejects a cycle and lists the steps involved", () => {
    expect(() => topoLayers([step("a", ["c"]), step("b", ["a"]), step("c", ["b"])])).toThrow(/cycle.*a, b, c/);
  });

  test("rejects self-dependency as a cycle", () => {
    expect(() => topoLayers([step("a", ["a"])])).toThrow(/cycle.*a/);
  });

  test("rejects unknown dependency with actionable message", () => {
    expect(() => topoLayers([step("a", ["nope"])])).toThrow(/"a".*unknown step "nope"/);
  });

  test("rejects duplicate step names", () => {
    expect(() => topoLayers([step("a"), step("a")])).toThrow(/duplicate.*a/);
  });

  test("empty pipeline yields no layers", () => {
    expect(topoLayers([])).toEqual([]);
  });
});
