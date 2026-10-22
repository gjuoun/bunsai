# bunsai

[English](README.md) | [简体中文](README.zh-CN.md)

**用代码写 CI/CD，不用 YAML** —— 面向 TypeScript 的可携带 pipeline runner：pipeline 是类型安全的 TS（`bunsai.config.ts`），由 Effect-TS 驱动，跑在纯 Bun 上。本地 / 笔记本 / 容器 / CI，同一条命令：`bunsai run`。

- [快速上手](#快速上手) · [CLI 参考](#cli-参考) · [编写 pipeline](#编写-pipeline)
- [缓存与断点恢复](#缓存与断点恢复) · [日志与运行记录](#日志与运行记录) · [DAG 预览](#dag-预览)
- [容器](#容器与-ci) · [GitHub Actions](#github-actions) · [示例](#示例)
- [工作原理](#工作原理) · [路线图](#状态025) · [开发](#开发)

## 快速上手

```sh
bun add -d bunsai
```

在你的 repo 根目录创建 `bunsai.config.ts`：

```ts
import { definePipeline } from "bunsai";

export default definePipeline({
  steps: [
    { name: "lint", run: (ctx) => ctx.shell("bunx oxlint") },
    { name: "unit-test", run: (ctx) => ctx.shell("bun test") },
    {
      name: "package",
      dependsOn: ["lint", "unit-test"], // 两者都跑完才执行；lint/unit-test 并行
      run: async (ctx) => {
        await ctx.shell("bun run build");
        ctx.logger.info("packaged");
      },
    },
    {
      name: "deploy",
      dependsOn: ["package"],
      retries: 2, // 失败自动指数退避重试
      inputs: ["dist/**"], // 内容哈希缓存键：这些文件变了，该 step 重跑
      run: (ctx) => ctx.shell("./scripts/deploy.sh"),
    },
  ],
});
```

跑起来：

```sh
bunx bunsai run                # 全量执行（首次）
bunx bunsai run                # 重跑：已缓存的 step 跳过
bunx bunsai run --dry-run      # 预览分层图，不执行任何东西
bunx bunsai run --from deploy  # 强制 deploy 及其全部下游重跑
bunx bunsai run --force        # 无视缓存，全量重跑
bunx bunsai run --last         # 回放上一次运行的图 + 失败 step 日志尾
```

本地没装 Bun？直接用容器——和 CI 同一个镜像同一条命令：

```sh
docker run --rm -v "$PWD:/work" -w /work ghcr.io/gjuoun/bunsai:0.2.5 run
```

## CLI 参考

| 命令 | 作用 |
|---|---|
| `bunsai run` | 加载 `./bunsai.config.ts`，跑 DAG，打印分层图与总结。退出码 0/1。 |
| `bunsai run --dry-run` | 打印分层图和每个 step 的判定；不执行、不写盘。 |
| `bunsai run --from <step>` | 强制 `<step>` 及其传递下游重跑；其余走正常缓存规则。 |
| `bunsai run --force` | 无视缓存，全部重跑。 |
| `bunsai run --last` | 只读回放：上一次运行的图 + 总结 + 每个失败 step 日志的最后 40 行。不能与 `--from`/`--force`/`--dry-run` 组合。 |
| `bunsai run --help` | `@effect/cli` 生成的完整用法。 |

## 编写 pipeline

pipeline 是类型安全的 TS —— 可以打断点、抽函数、写测试。每个 step 的 `run(ctx)` 拿到：

- **`ctx.shell(cmd)`** —— 在 step 的 cwd/env 里用 `Bun.spawn` 跑 `sh -c <cmd>`；输出实时打到终端**并**同步 tee 进 step 日志。非零退出抛出带 step 名的 plain `Error`（重试机制就靠它捕获）。
- **`ctx.logger`** —— `info`/`error`，以 `[bunsai] …` 行写进 step 日志。
- **`ctx.cwd` / `ctx.env`** —— 本次运行的工作目录和环境。

step 字段：

- **`name`** —— 唯一；作为日志文件名（路径不安全字符会被 slug 化）。
- **`dependsOn: string[]`** —— DAG 边。无依赖的 step 并行跑（有并发上限，默认 4）。环、重名、未知依赖会在开始前被拒绝，报错可直接行动。
- **`retries: n`** —— n 次自动重试，指数退避（50ms 起、2s 封顶）。
- **`inputs: string[]`** —— 路径/glob（相对 cwd），按**内容哈希**折进缓存键（见下）。

## 缓存与断点恢复

运行状态在每个 step 后写入 `.bunsai/state.json`（gitignored）。只有当 **`status === "success"` 且 `inputHash` 仍然匹配** 时才跳过（`⤼ (cached)`）——`inputHash` 是 step 定义序列化 + `inputs` 匹配到的所有文件**字节**的 sha256。

- 改了声明的 input → 只有该 step（加上依赖它的下游）重跑。
- 没声明 `inputs` 的 step 只哈希自身定义——把 step 消费的产物声明成 `inputs` 才能串起链条。
- `touch` 不会触发失效：哈希的是字节不是 mtime——所以 `git checkout`/`rsync` 永远不会误伤缓存。
- 输入哈希出现之前写入的旧 state 会重跑一次，绝不假装跳过。

诚实边界（有意设计）：`run` 闭包捕获的东西不可观测；环境变量和工具链版本不进哈希键。

## 日志与运行记录

每次运行在 `.bunsai/`（gitignored）下生成：

- **`logs/<run-id>/<step>.log`** —— 每 step 的合并输出，边流边写（绝不先攒后打）。被杀掉的运行也留下可读的部分日志。
- **`runs/<run-id>.json`** —— 运行记录（`yyyymmddThhmmssSSSZ`，UTC、可按字典序排序），每个 step 后重写：状态、尝试次数、耗时、`inputHash`、日志路径、错误、`dependsOn` 边——所以 `--last` 不加载你的 config 就能重画图。

## DAG 预览

`bunsai run --dry-run` 回答"将要发生什么"，不执行任何东西——没有 step 运行、不写 `.bunsai` 目录：

```text
$ bunsai run --dry-run --from package
layers: 3 · 4 steps
  L1  ├─ lint            cached
      └─ unit-test       cached
  L2  └─ package         run (forced) ← lint, unit-test
  L3  └─ deploy-dry-run  run (forced) ← package · retries 2

dry-run: nothing executed
```

判定只报事实：`run`、`cached`、`run (forced)`、`run (input changed)`、`run (prior failed)`。从不预测 blocked——阻塞需要依赖真实失败才会发生，所以 `⤼ (blocked)` 只出现在跑后的图里。真实运行和 `--last` 用同样的几何布局渲染结果：

```text
layers: 3 · 4 steps
  L1  ├─ lint            ⤼ (cached)
      └─ unit-test       ⤼ (cached)
  L2  └─ package         ✓ [10ms] (1 attempt) ← lint, unit-test
  L3  └─ deploy-dry-run  ✓ [0ms] (1 attempt) ← package

total: 11ms
✓ 2/4 steps succeeded
```

`--dry-run` 是 `run` 的一个模式（不是独立子命令），因此复用与 runner 完全相同的缓存判定——预览永远不会和执行脱节。

## 容器与 CI

运行时镜像已内置 bunsai，pipeline 不需要自己的 Dockerfile：

```sh
docker run --rm -v "$PWD:/work" -w /work ghcr.io/gjuoun/bunsai:0.2.5 run
docker run --rm -v "$PWD:/work" -w /work ghcr.io/gjuoun/bunsai:0.2.5 run --dry-run
```

- 镜像 = `oven/bun:1` + 薄工具层（git、curl、docker CLI——wrangler/ssh 随 deployer 插件到来），每个 `v*` tag 发布 `linux/amd64` + `linux/arm64` 双架构。
- pipeline 里要 build 容器？加 `-v /var/run/docker.sock:/var/run/docker.sock`。容器以 root 运行，Linux runner 上 `/work` 挂载可写。
- 基于它做自己的镜像：`FROM ghcr.io/gjuoun/bunsai:0.2.5` + `COPY . .`——你的层只放业务依赖。

## GitHub Actions

复合 Action 把 workspace 挂到 `/work` 并跑同一个镜像：

```yaml
- uses: gjuoun/bunsai@v0.2.5
  with:
    args: run --force
```

`args`（默认 `run`）、`image`（默认 `ghcr.io/gjuoun/bunsai:0.2.5`）、`workdir`（默认 `${{ github.workspace }}`）都是输入——CI 里换 tag 或跑 `--dry-run` 不用动 workflow。

## 示例

- **`examples/`** —— demo pipeline：两个并行 step → 一个依赖两者的 step → 一个故意失败一次再靠重试成功的 step（`retries: 2`）。运行：`cd examples && bun ../src/cli.ts run`。
- **`examples/docker-app/`** —— 真实端到端：Bun HTTP 服务 + `bun test` 测试 → docker build（docker/podman 自动探测）→ 容器冒烟轮询 `/healthz`。运行：`cd examples/docker-app && bun ../../src/cli.ts run`。

## 工作原理

- **一个模块只管一件事** —— `src/pipeline/`（scheduler、`definePipeline`、`runner/` 拆成 `graph`/`step`/`pipeline-runner`/`run`）、`src/services/`（state store、shell runner、logger、run config）、`src/cli/`（命令树、run 命令、渲染）、`src/config/load.ts`（config 发现）。每个文件不超过 300 行，相对导入图必须无环（`scripts/check-structure.ts`）。
- **Effect service + 依赖注入** —— `StateStore`、`ShellRunner`、`LoggerService`、`RunConfig`、`PipelineRunner` 是用 Layer 组合的 `Context.Tag` class service；runner 由构造器注入依赖，不碰全局。`runPipeline(pipeline, options)` 仍是 Promise 风格的门面。
- **模块按需加载** —— `src/index.ts` 是无 CLI 的公共入口；`src/cli.ts` 是 9 行 bootstrap，只在 `import.meta.main` 时才 import `@effect/cli` 程序；pipeline config 按需加载。`scripts/check-lazy.ts` 从 bundle 图上证明这一点。
- **DAG 调度** —— 拓扑分层；无依赖 step 由 Effect 信号量限并发并行（默认 4）。
- **错误** —— 全程 plain `Error` + 可行动的信息；没有 Error 子类或错误信封。

## 状态：0.2.5

- [x] `definePipeline` 类型化 pipeline 定义 + 形状校验
- [x] DAG 调度器（拓扑分层、环检测、无依赖并行）
- [x] Effect-TS runner：信号量限并发、指数退避重试
- [x] 状态存储 + 断点恢复：cached-skip、`--from <step>`、`--force`
- [x] 声明 `inputs` 的内容哈希缓存失效
- [x] 每 step 日志、运行记录、`--last` 回放
- [x] 分层 DAG 预览：`--dry-run`、跑后图、`--last` 图
- [x] 运行时镜像（`linux/amd64` + `linux/arm64`）、容器内 e2e、复合 Action

**路线图**：deployer（Cloudflare Pages / ssh / docker，插件化 + SDK 优先）、reporter（Discord webhook 等）、插件系统、secret 注入（1Password/opk，值永不落盘）、multi-worker 并行（每 worker 独立容器上下文）。

## 开发

```sh
bun test                            # 就近测试套件
bunx tsc -p tsconfig.json --noEmit  # 严格 typecheck
bun run check                       # 测试 + typecheck + 结构 + 懒加载门禁
bun run verify:examples             # 两个示例 pipeline 端到端
bun run verify:cache                # 日志/运行记录 + 输入哈希缓存演示
bun run verify:image                # 构建镜像，在容器里跑 examples/
```

门禁：`scripts/check-structure.ts` 强制 300 行帽和无环导入图；`scripts/check-lazy.ts` 证明核心入口无急切 CLI 代码；`scripts/verify-examples.sh` 从干净状态重跑两个示例；`scripts/verify-cache.sh` 证明日志/记录文件落地、改声明的 input 只重跑受影响的 step；`scripts/verify-image.sh` 证明容器运行时（`--action` 校验 action 默认值，`--multiarch` 证明双平台 OCI index）。

运行时依赖：`effect`、`@effect/cli`（类型化参数解析、内置 `--help`）、`@effect/platform-bun`。
