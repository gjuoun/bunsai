# bunsai

**CI/CD in code, not YAML** — a portable pipeline runner for TypeScript: pipelines are typed TS (`bunsai.config.ts`), driven by Effect-TS, run on pure Bun. Local / laptop / container / CI, same command: `bunsai run`.

## Quick start

```sh
bun add -d bunsai        # or just have Bun, and run the CLI from this repo
```

Create `bunsai.config.ts` in your repo:

```ts
import { definePipeline } from "bunsai";

export default definePipeline({
  steps: [
    { name: "lint", run: (ctx) => ctx.shell("bunx oxlint") },
    { name: "unit-test", run: (ctx) => ctx.shell("bun test") },
    {
      name: "package",
      dependsOn: ["lint", "unit-test"], // runs after both; lint/unit-test run in parallel
      run: async (ctx) => {
        await ctx.shell("bun run build");
        ctx.logger.info("packaged");
      },
    },
    {
      name: "deploy",
      dependsOn: ["package"],
      retries: 2, // exponential backoff on failure
      run: (ctx) => ctx.shell("./scripts/deploy.sh"),
    },
  ],
});
```

Run it:

```sh
bunx bunsai run                # run everything (first time)
bunx bunsai run                # rerun: already-successful steps are skipped (cached)
bunx bunsai run --from deploy  # force deploy and everything downstream of it to rerun
bunx bunsai run --force        # ignore cache, rerun all steps
```

Try the demo in this repo:

```sh
cd examples
bun ../src/cli.ts run
```

## How it works

- **One concern per module** — `src/pipeline/` (scheduler, `definePipeline`, and `src/pipeline/runner/*` split into `graph` / `step` / `pipeline-runner` / `run`), `src/services/` (state store, shell runner, logger, run config), `src/cli/` (command tree, run command, rendering), `src/config/load.ts` (config discovery). Every file stays under 300 lines and the relative-import graph must stay acyclic (`scripts/check-structure.ts`).
- **Effect services with injected dependencies** — `StateStore`, `ShellRunner`, `LoggerService`, `RunConfig` and `PipelineRunner` are `Context.Tag` class services composed with Layers; the runner is constructed with its dependencies and reaches for no globals. `runPipeline(pipeline, options)` remains the Promise-based facade.
- **Lazy per-module loading** — `src/index.ts` is the CLI-free public entry, `src/cli.ts` is a bootstrap that imports the `@effect/cli` program only under `import.meta.main`, and a pipeline config is imported on demand. `scripts/check-lazy.ts` proves it from the bundle graph, with the eager program bundle as a positive control.
- **DAG scheduling** — steps declare `dependsOn`; independent steps run in parallel (bounded by an Effect `Semaphore`, default concurrency 4). Cycles, duplicate names, and unknown deps are rejected up front with actionable errors; a cycle error lists the stuck steps.
- **Step context** — every `run(ctx)` gets `{ cwd, env, logger, shell }`. `shell(cmd)` runs via `Bun.spawn` with inherited stdio, returns the exit code, and throws a plain `Error` naming the failing step on non-zero exit.
- **Retries** — `retries: n` gives a step n automatic retries with exponential backoff (50ms base, 2s cap), managed by Effect.
- **Resume from breakpoints** — run state is persisted to `.bunsai/state.json` (gitignored) after every step: `{ status, startedAt, endedAt, attempts, durationMs }`. Rerunning skips `success` steps and logs `skip (cached)`; failed steps rerun. The CLI prints per-step timing and a final summary; exit code is 0/1.
- **Errors** — plain `Error`s with actionable messages throughout; no error subclasses or envelopes.

## Status: 0.1 (milestone complete)

Implemented and tested (`bun test`, colocated `*.test.ts`):

- [x] `definePipeline` typed pipeline definition with shape validation
- [x] DAG scheduler (topological layers, cycle detection, parallel independent steps)
- [x] Effect-TS runner: semaphore-bounded parallelism, exponential-backoff retries
- [x] State store + resume: `.bunsai/state.json`, cached-skip, `--from <step>`, `--force`
- [x] `ctx.shell` via `Bun.spawn` (inherited stdio, step-named errors)
- [x] CLI: `bunsai run [--from <step>] [--force]`, config discovery, timing summary
- [x] Demo pipeline in `examples/`

**Not implemented yet (roadmap):**

- Deployers (Cloudflare Pages / ssh / docker) — planned as plugins, SDK-first
- Reporters (Discord webhook etc.)
- Plugin system (auto-discovery + `plugins.ts` registry + self-declared deps install)
- Secret injection (1Password/opk integration; values never persisted)
- GitHub Actions thin-shell YAML (checkout + bun + `bunx bunsai run`)
- Container runner (podman) / multi-environment detection
- Input-hash-based invalidation (cache is success-based only in 0.1)

## Development

```sh
bun test                            # colocated test suites
bunx tsc -p tsconfig.json --noEmit  # strict typecheck
bun run check                       # test + typecheck + structure + lazy gates
bun run verify:examples             # both example pipelines, end to end
```

Gates: `scripts/check-structure.ts` enforces the 300-line cap and an acyclic relative-import graph; `scripts/check-lazy.ts` proves the core entry and the bin stay free of eager CLI code; `scripts/verify-examples.sh` reruns `examples/` and `examples/docker-app/` from clean state.

Runtime dependencies: `effect`, `@effect/cli` (typed argument parsing, built-in `--help`), `@effect/platform-bun`.
