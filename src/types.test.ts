import { describe, expect, test } from "bun:test";
import { definePipeline, type Pipeline } from "./types.ts";

describe("definePipeline", () => {
  test("returns the pipeline as-is (identity, for type inference)", () => {
    const pipeline = definePipeline({
      steps: [
        {
          name: "build",
          run: async (ctx) => {
            await ctx.shell("echo building in " + ctx.cwd);
          },
        },
      ],
    });
    expect(pipeline.steps.length).toBe(1);
    expect(pipeline.steps[0]!.name).toBe("build");
  });

  test("accepts optional dependsOn and retries", () => {
    const pipeline = definePipeline({
      steps: [
        { name: "a", run: () => {} },
        { name: "b", dependsOn: ["a"], retries: 2, run: () => {} },
      ],
    });
    expect(pipeline.steps[1]!.dependsOn).toEqual(["a"]);
    expect(pipeline.steps[1]!.retries).toBe(2);
  });

  test("rejects a step with an empty name", () => {
    expect(() =>
      definePipeline({
        steps: [{ name: "", run: () => {} }],
      })
    ).toThrow(/name/);
  });

  test("rejects a step without a run function", () => {
    expect(() =>
      definePipeline({
        steps: [{ name: "x" } as unknown as Pipeline["steps"][number]],
      })
    ).toThrow(/run/);
  });

  test("rejects negative retries", () => {
    expect(() =>
      definePipeline({
        steps: [{ name: "x", retries: -1, run: () => {} }],
      })
    ).toThrow(/retries/);
  });
});
