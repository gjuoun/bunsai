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
bunx bunsai run --dry-run      # preview the layered graph, execute nothing
bunx bunsai run --last         # replay the previous run's graph and tail failed logs
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
- **Step context** — every `run(ctx)` gets `{ cwd, env, logger, shell }`. `shell(cmd)` runs via `Bun.spawn`, returns the exit code, and throws a plain `Error` naming the failing step on non-zero exit; its stdout/stderr stream live to the terminal and are teed into the step log.
- **Logs and run records** — each run creates `.bunsai/logs/<run-id>/<step>.log` and `.bunsai/runs/<run-id>.json` (rewritten after every step, so a killed run leaves a readable partial history). Records carry per-step `dependsOn` edges, so `bunsai run --last` can redraw the layered graph and tail the failed step's log without loading the config.
- **DAG preview** — `--dry-run` renders the topological layers with per-step verdicts (`run`, `cached`, `run (forced)`, `run (input changed)`, `run (prior failed)`), dependencies and retry counts, and executes nothing; a real run and `--last` render the same geometry with `✓`/`✗`/`⤼` icons, durations and attempts. One pure renderer over `topoLayers` + state + the run result/record, no new dependencies.
- **Retries** — `retries: n` gives a step n automatic retries with exponential backoff (50ms base, 2s cap), managed by Effect.
- **Resume from breakpoints** — run state is persisted to `.bunsai/state.json` (gitignored) after every step: `{ status, startedAt, endedAt, attempts, durationMs, inputHash }`. Rerunning skips a `success` step only while its `inputHash` still matches and logs `skip (cached)`; failed or invalidated steps rerun. The CLI prints per-step timing and a final summary; exit code is 0/1.
- **Errors** — plain `Error`s with actionable messages throughout; no error subclasses or envelopes.

## 0.2 — honest resume

- **Per-step logs** — every step's output is teed to `.bunsai/logs/<run-id>/<step>.log` while it keeps streaming live to the terminal (never buffer-then-print). Step `logger.info`/`logger.error` lines are copied in as `[bunsai] …` lines.
- **Run records** — each run writes `.bunsai/runs/<run-id>.json`, id `yyyymmddThhmmssSSSZ` (UTC, lexicographically sortable): per-step status, attempts, durations, `inputHash`, log path, error.
- **`bunsai run --last`** — prints the previous run's layered graph and summary and tails every failed step's log (last 40 lines). Read-only: it executes no steps and cannot be combined with `--from`/`--force`/`--dry-run`.
- **Input-hash invalidation** — declare `inputs` on a step (paths or globs relative to its cwd). A cached success is reused only while the hash of the step definition plus those file contents is unchanged. State written before 0.2 carries no hash, so it reruns once instead of falsely skipping.

Honesty limits, by design: what a `run` closure captures is not observable, so a step with no `inputs` hashes only its definition; file **bytes** are hashed, not mtimes (a `touch` alone does not invalidate); environment variables and toolchain versions are not part of the key. A step is judged only on its own definition and inputs — when an upstream step reruns but a downstream step's inputs are unchanged, the downstream step still skips, so declare the artifacts a step consumes as `inputs` to link the chain.

## Container and CI

The runtime image bundles bunsai, so a pipeline needs no Dockerfile of its own:

```sh
docker run --rm -v "$PWD:/work" -w /work ghcr.io/gjuoun/bunsai:0.2.5 run
docker run --rm -v "$PWD:/work" -w /work ghcr.io/gjuoun/bunsai:0.2.5 run --dry-run
```

The image is `oven/bun:1` plus a thin tool layer (git, curl, docker CLI — wrangler/ssh arrive with deployer plugins), published for `linux/amd64` and `linux/arm64` on every `v*` tag. Add `-v /var/run/docker.sock:/var/run/docker.sock` only when a pipeline builds containers, and note that the container runs as root so `-v "$PWD:/work"` stays writable on Linux runners.

In GitHub Actions, the composite action mounts the workspace at `/work` and runs the same image:

```yaml
- uses: gjuoun/bunsai@v1
  with:
    args: run --force
```

`args`, `image` and `workdir` are inputs, so a pipeline can pin another tag or call `--dry-run`. Verify the image locally with `bun run verify:image`; append `--action` or `--multiarch` to `bash scripts/verify-image.sh` to also check the action defaults or build the two-platform OCI index.

## Preview the DAG

`bunsai run --dry-run` answers "what will happen" without executing anything — no step runs, no `.bunsai` directory is written:

```text
$ bun ../src/cli.ts run --dry-run --from package
layers: 3 · 4 steps
  L1  ├─ lint            cached
      └─ unit-test       cached
  L2  └─ package         run (forced) ← lint, unit-test
  L3  └─ deploy-dry-run  run (forced) ← package · retries 2

dry-run: nothing executed
```

Verdicts are facts only: `run`, `cached`, `run (forced)`, `run (input changed)` and `run (prior failed)`. A step is never predicted as blocked — blocking requires a dependency to fail in a real run, so `⤼ (blocked)` appears only in post-run graphs. Every run and `bunsai run --last` render the same geometry with the outcome:

```text
layers: 3 · 4 steps
  L1  ├─ lint            ⤼ (cached)
      └─ unit-test       ⤼ (cached)
  L2  └─ package         ✓ [10ms] (1 attempt) ← lint, unit-test
  L3  └─ deploy-dry-run  ✓ [0ms] (1 attempt) ← package

total: 11ms
✓ 2/4 steps succeeded
```

`--dry-run` is a mode of `run` rather than a `preview` subcommand: it reuses config discovery and the same cache verdict as the runner (`cacheVerdict`), so the preview cannot drift from what the runner decides.

## 0.2.5 — runner image and DAG preview

- **Runtime image** — `Dockerfile` at the repo root, bunsai installed from the lockfile at build time (no npm fetch at runtime), `ENTRYPOINT ["bunsai"]`, multi-arch publish workflow on `v*` tags, and `scripts/verify-image.sh` running `examples/` *inside* the container.
- **Composite action** — `uses: gjuoun/bunsai@v1` runs a pipeline in that image on GitHub Actions; the workflow tag is read from `package.json`, and the action's default image is checked against it locally.
- **DAG preview** — `run --dry-run`, the post-run graph, and the `--last` graph, all from one pure renderer; run records now carry `dependsOn` edges (schemaVersion 2) so `--last` needs no config load.

## Status: 0.2.5


Implemented and tested (`bun test`, colocated `*.test.ts`):

- [x] `definePipeline` typed pipeline definition with shape validation
- [x] DAG scheduler (topological layers, cycle detection, parallel independent steps)
- [x] Effect-TS runner: semaphore-bounded parallelism, exponential-backoff retries
- [x] State store + resume: `.bunsai/state.json`, cached-skip, `--from <step>`, `--force`
- [x] `ctx.shell` via `Bun.spawn` (inherited stdio, step-named errors)
- [x] CLI: `bunsai run [--from <step>] [--force]`, config discovery, timing summary
- [x] Demo pipeline in `examples/`
- [x] Per-step logs, run records, and `bunsai run --last`
- [x] Input-hash cache invalidation via declared `inputs`
- [x] Layered DAG preview: `run --dry-run`, post-run graph, `--last` graph
- [x] Runtime image (`linux/amd64` + `linux/arm64`), in-container e2e, composite Action

**Not implemented yet (roadmap):**

- Deployers (Cloudflare Pages / ssh / docker) — planned as plugins, SDK-first
- Reporters (Discord webhook etc.)
- Plugin system (auto-discovery + `plugins.ts` registry + self-declared deps install)
- Secret injection (1Password/opk integration; values never persisted)
- Docker socket passthrough in the Action (mount `/var/run/docker.sock` yourself today)
- Container runner (podman) / multi-environment detection

## Development

```sh
bun test                            # colocated test suites
bunx tsc -p tsconfig.json --noEmit  # strict typecheck
bun run check                       # test + typecheck + structure + lazy gates
bun run verify:examples             # both example pipelines, end to end
bun run verify:cache                # logs/run records + input-hash cache demo
bun run verify:image                # build the image, run examples/ inside the container
```

Gates: `scripts/check-structure.ts` enforces the 300-line cap and an acyclic relative-import graph; `scripts/check-lazy.ts` proves the core entry and the bin stay free of eager CLI code; `scripts/verify-examples.sh` reruns `examples/` and `examples/docker-app/` from clean state; `scripts/verify-cache.sh` proves the log/run-record files and that editing a declared input reruns exactly the affected step; `scripts/verify-image.sh` proves the container runtime (`--action` checks the action defaults, `--multiarch` proves the two-platform OCI index).

Runtime dependencies: `effect`, `@effect/cli` (typed argument parsing, built-in `--help`), `@effect/platform-bun`.
