import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { DEFAULT_CONCURRENCY, RunConfig, resolveRunConfig, runConfigLayer } from "./run-config.ts";

describe("RunConfig", () => {
  test("resolves defaults: cwd=root, env=process.env, concurrency=4, force=false", () => {
    const resolved = resolveRunConfig({ root: "/repo" });
    expect(resolved.cwd).toBe("/repo");
    expect(resolved.env).toBe(process.env);
    expect(resolved.concurrency).toBe(DEFAULT_CONCURRENCY);
    expect(resolved.concurrency).toBe(4);
    expect(resolved.from).toBeUndefined();
    expect(resolved.force).toBe(false);
  });

  test("keeps explicit values and the layer serves them", async () => {
    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* RunConfig;
      }).pipe(
        Effect.provide(
          runConfigLayer({ root: "/r", cwd: "/c", env: { A: "1" }, concurrency: 2, from: "build", force: true })
        )
      )
    );
    expect(resolved).toEqual({ root: "/r", cwd: "/c", env: { A: "1" }, concurrency: 2, from: "build", force: true });
  });
});