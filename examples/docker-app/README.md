# docker-app — bunsai 完整示例项目

一个小型 Bun HTTP 服务 + 测试 + docker build + 容器冒烟的端到端 pipeline：

- `src/server.ts` — Bun.serve，`/healthz` + `/`
- `src/server.test.ts` — 3 个 bun test（真实起服务 fetch 断言）
- `Dockerfile` — `oven/bun:1` 基础镜像 + HEALTHCHECK
- `bunsai.config.ts` — 4 步 DAG：install → test → docker-build → smoke

## 跑

```sh
cd examples/docker-app
bun ../../src/cli.ts run
```

- docker 优先、podman 兜底（自动探测）
- smoke 步骤会把刚 build 的镜像跑起来，轮询 `http://localhost:31080/healthz`，通了再删容器
- 重跑时 install/test/docker-build 走 cache 跳过，只重跑失败或 `--from` 指定的步骤
