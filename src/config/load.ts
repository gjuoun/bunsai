import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Pipeline } from "../types.ts";

/** Load and validate <cwd>/bunsai.config.ts (default export or named `pipeline`). */
export async function loadPipeline(cwd: string): Promise<Pipeline> {
  const configPath = join(cwd, "bunsai.config.ts");
  if (!existsSync(configPath)) {
    throw new Error(
      `bunsai: no bunsai.config.ts found in ${cwd}. Create one exporting a pipeline, e.g.\n` +
        '  import { definePipeline } from "bunsai";\n' +
        '  export default definePipeline({ steps: [{ name: "build", run: (ctx) => ctx.shell("make build") }] });\n' +
        "See examples/bunsai.config.ts for a fuller demo."
    );
  }
  // Loaded on demand: only the selected config module (and what it imports) enters memory.
  const mod = (await import(configPath)) as { default?: unknown; pipeline?: unknown };
  const config = mod.default ?? mod.pipeline;
  if (config === undefined || typeof config !== "object" || !Array.isArray((config as { steps?: unknown }).steps)) {
    throw new Error(
      `bunsai: ${configPath} must export a pipeline (default export or named \`pipeline\`) with a non-empty "steps" array — wrap it in definePipeline({ steps: [...] })`
    );
  }
  return config as Pipeline;
}