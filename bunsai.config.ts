import { definePipeline } from "./src/pipeline/define-pipeline.ts";

/**
 * bunsai's own pipeline — dogfooded in CI through the published container image
 * (.github/workflows/ci.yml -> action.yml -> ghcr.io/gjuoun/bunsai).
 */
export default definePipeline({
  steps: [
    {
      name: "install",
      run: async (ctx) => {
        await ctx.shell("bun install --frozen-lockfile");
      },
    },
    {
      name: "check",
      dependsOn: ["install"],
      inputs: ["src/**", "scripts/**", "bun.lock"],
      run: async (ctx) => {
        await ctx.shell("bun run check");
      },
    },
  ],
});
