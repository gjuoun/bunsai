# bunsai

[English](README.md) | [简体中文](README.zh-CN.md)

**CI/CD in code, not YAML** — a portable pipeline runner for TypeScript: pipelines are typed TS (`bunsai.config.ts`), driven by Effect-TS, run on pure Bun. Local / laptop / container / CI, same command: `bunsai run`.

- [Quick start](#quick-start) · [CLI reference](#cli-reference) · [Writing a pipeline](#writing-a-pipeline)
- [Cache and resume](#cache-and-resume) · [Logs and run records](#logs-and-run-records) · [Preview the DAG](#preview-the-dag)
- [Container](#container-and-ci) · [GitHub Actions](#github-actions) · [Examples](#examples)
- [How it works](#how-it-works) · [Roadmap](#status-025) · [Development](#development)

## Quick start

```sh
bun add -d bunsai
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
      inputs: ["dist/**"], // content-hash cache key: edit these files and the step reruns
      run: (ctx) => ctx.shell("./scripts/deploy.sh"),
    },
  ],
});
```

Run it:

```sh
bunx bunsai run                # run everything (first time)
bunx bunsai run                # rerun: cached steps are skipped
bunx bunsai run --dry-run      # preview the layered graph, execute nothing
bunx bunsai run --from deploy  # force deploy and everything downstream to rerun
bunx bunsai run --force        # ignore cache, rerun all steps
bunx bunsai run --last         # replay the previous run's graph and tail failed logs
```

No Bun locally? Use the container — same command, same image as CI:

```sh
docker run --rm -v "$PWD:/work" -w /work ghcr.io/gjuoun/bunsai:0.2.5 run
```

## CLI reference

| Command | What it does |
|---|---|
| `bunsai run` | Load `./bunsai.config.ts`, run the DAG, print the layered graph and summary. Exit 0/1. |
| `bunsai run --dry-run` | Print the layer graph with per-step verdicts; executes nothing, writes nothing. |
| `bunsai run --from <step>` | Force `<step>` and its transitive downstream to rerun; others follow normal cache rules. |
| `bunsai run --force` | Ignore the cache; rerun every step. |
| `bunsai run --last` | Read-only replay: previous run's graph + summary + last 40 lines of each failed step's log. Cannot combine with `--from`/`--force`/`--dry-run`. |
| `bunsai run --help` | Full usage from `@effect/cli`. |

## Writing a pipeline

A pipeline is typed TS — break points, functions, tests. Every step gets `run(ctx)` with:

- **`ctx.shell(cmd)`** — runs `sh -c <cmd>` via `Bun.spawn` in the step's cwd/env; output streams live to the terminal **and** is teed into the step log. Non-zero exit throws a plain `Error` naming the step (that's what retries catch).
- **`ctx.logger`** — `info`/`error`, copied into the step log as `[bunsai] …` lines.
- **`ctx.cwd` / `ctx.env`** — the run's working directory and environment.

Step fields:

- **`name`** — unique; becomes the log filename (path-unsafe characters are slugified).
- **`dependsOn: string[]`** — DAG edges. Independent steps run in parallel (bounded, default 4). Cycles, duplicate names, and unknown deps are rejected up front with actionable errors.
- **`retries: n`** — n automatic retries with exponential backoff (50ms base, 2s cap).
- **`inputs: string[]`** — paths/globs (relative to cwd) folded into the cache key by **content hash** (see below).

## Cache and resume

Run state persists to `.bunsai/state.json` (gitignored) after every step. A step is skipped (`⤼ (cached)`) only while **`status === "success"` AND its `inputHash` still matches** — where `inputHash` is sha256 over the serialized step definition plus the **bytes** of every file matched by `inputs`.

- Edit a declared input → only that step (and, via the DAG, what depends on it) reruns.
- A step with no `inputs` hashes only its definition — declare what a step consumes to link the chain.
- `touch` alone does nothing: bytes are hashed, not mtimes — so `git checkout`/`rsync` never falsely invalidate.
- State written before input-hashes existed reruns once instead of falsely skipping.

Honesty limits, by design: what a `run` closure captures is not observable; environment variables and toolchain versions are not part of the key.

## Logs and run records

Every run creates, under `.bunsai/` (gitignored):

- **`logs/<run-id>/<step>.log`** — per-step combined output, written as it streams (never buffer-then-print). A killed run still leaves readable partial logs.
- **`runs/<run-id>.json`** — run record (`yyyymmddThhmmssSSSZ`, UTC, sortable), rewritten after every step: per-step status, attempts, durations, `inputHash`, log path, error, and `dependsOn` edges — which is why `--last` can redraw the graph without loading your config.

## Preview the DAG

`bunsai run --dry-run` answers "what will happen" without executing anything — no step runs, no `.bunsai` directory is written:

```text
$ bunsai run --dry-run --from package
layers: 3 · 4 steps
  L1  ├─ lint            cached
      └─ unit-test       cached
  L2  └─ package         run (forced) ← lint, unit-test
  L3  └─ deploy-dry-run  run (forced) ← package · retries 2

dry-run: nothing executed
```

Verdicts are facts only: `run`, `cached`, `run (forced)`, `run (input changed)`, `run (prior failed)`. A step is never predicted as blocked — blocking requires a dependency to actually fail, so `⤼ (blocked)` appears only in post-run graphs. Real runs and `--last` render the same geometry with outcomes:

```text
layers: 3 · 4 steps
  L1  ├─ lint            ⤼ (cached)
      └─ unit-test       ⤼ (cached)
  L2  └─ package         ✓ [10ms] (1 attempt) ← lint, unit-test
  L3  └─ deploy-dry-run  ✓ [0ms] (1 attempt) ← package

total: 11ms
✓ 2/4 steps succeeded
```

`--dry-run` is a mode of `run` (not a separate command) so it reuses the exact same cache verdict the runner uses — the preview cannot drift from execution.

## Container and CI

The runtime image bundles bunsai, so a pipeline needs no Dockerfile of its own:

```sh
docker run --rm -v "$PWD:/work" -w /work ghcr.io/gjuoun/bunsai:0.2.5 run
docker run --rm -v "$PWD:/work" -w /work ghcr.io/gjuoun/bunsai:0.2.5 run --dry-run
```

- Image = `oven/bun:1` + thin tool layer (git, curl, docker CLI — wrangler/ssh arrive with deployer plugins), published for `linux/amd64` + `linux/arm64` on every `v*` tag.
- Building containers inside the pipeline? Add `-v /var/run/docker.sock:/var/run/docker.sock`. The container runs as root, so the `/work` mount stays writable on Linux runners.
- Base your own image: `FROM ghcr.io/gjuoun/bunsai:0.2.5` + `COPY . .` — your layer carries only business deps.

## GitHub Actions

The composite action mounts the workspace at `/work` and runs the same image:

```yaml
- uses: gjuoun/bunsai@v0.2.5
  with:
    args: run --force
```

`args` (default `run`), `image` (default `ghcr.io/gjuoun/bunsai:0.2.5`) and `workdir` (default `${{ github.workspace }}`) are inputs — pin another tag or call `--dry-run` from CI without touching your workflow.

## Examples

- **`examples/`** — demo pipeline: two parallel steps → a dependent step → a flaky step that fails once and succeeds on retry (`retries: 2`). Run: `cd examples && bun ../src/cli.ts run`.
- **`examples/docker-app/`** — a real end-to-end: Bun HTTP service + `bun test` suite → docker build (docker-or-podman autodetect) → container smoke test polling `/healthz` over real HTTP. Run: `cd examples/docker-app && bun ../../src/cli.ts run`.

## How it works

- **One concern per module** — `src/pipeline/` (scheduler, `definePipeline`, `runner/` split into `graph`/`step`/`pipeline-runner`/`run`), `src/services/` (state store, shell runner, logger, run config), `src/cli/` (command tree, run command, rendering), `src/config/load.ts` (config discovery). Every file stays under 300 lines and the relative-import graph must stay acyclic (`scripts/check-structure.ts`).
- **Effect services with injected dependencies** — `StateStore`, `ShellRunner`, `LoggerService`, `RunConfig`, `PipelineRunner` are `Context.Tag` class services composed with Layers; the runner is constructed with its dependencies and touches no globals. `runPipeline(pipeline, options)` remains the Promise-based facade.
- **Lazy per-module loading** — `src/index.ts` is the CLI-free public entry; `src/cli.ts` is a 9-line bootstrap that imports the `@effect/cli` program only under `import.meta.main`; pipeline configs import on demand. `scripts/check-lazy.ts` proves it from the bundle graph.
- **DAG scheduling** — topological layers; independent steps run in parallel bounded by an Effect semaphore (default 4).
- **Errors** — plain `Error`s with actionable messages throughout; no error subclasses or envelopes.

## Status: 0.2.5

- [x] `definePipeline` typed pipeline definition with shape validation
- [x] DAG scheduler (topological layers, cycle detection, parallel independent steps)
- [x] Effect-TS runner: semaphore-bounded parallelism, exponential-backoff retries
- [x] State store + resume: cached-skip, `--from <step>`, `--force`
- [x] Input-hash cache invalidation via declared `inputs`
- [x] Per-step logs, run records, `--last` replay
- [x] Layered DAG preview: `--dry-run`, post-run graph, `--last` graph
- [x] Runtime image (`linux/amd64` + `linux/arm64`), in-container e2e, composite Action

**Roadmap:** deployers (Cloudflare Pages / ssh / docker, plugin + SDK-first), reporters (Discord webhook etc.), plugin system, secret injection (1Password/opk; values never persisted), multi-worker parallel runs with isolated container contexts.

## Development

```sh
bun test                            # colocated test suites
bunx tsc -p tsconfig.json --noEmit  # strict typecheck
bun run check                       # test + typecheck + structure + lazy gates
bun run verify:examples             # both example pipelines, end to end
bun run verify:cache                # logs/run records + input-hash cache demo
bun run verify:image                # build the image, run examples/ inside the container
```

Gates: `scripts/check-structure.ts` enforces the 300-line cap and an acyclic import graph; `scripts/check-lazy.ts` proves the core entry stays free of eager CLI code; `scripts/verify-examples.sh` reruns both examples from clean state; `scripts/verify-cache.sh` proves log/run-record files and that editing a declared input reruns exactly the affected step; `scripts/verify-image.sh` proves the container runtime (`--action` checks action defaults, `--multiarch` proves the two-platform OCI index).

Runtime dependencies: `effect`, `@effect/cli` (typed argument parsing, built-in `--help`), `@effect/platform-bun`.
