import { definePipeline } from "../../src/index.ts";

/**
 * Real-world example: test → docker build → container smoke test.
 *
 *   cd examples/docker-app
 *   bun ../../src/cli.ts run
 *
 * Uses docker if available, else podman. The smoke step boots the freshly
 * built image, polls /healthz over real HTTP, then removes the container.
 */

const IMAGE = "bunsai-example:latest";
const CONTAINER = "bunsai-example-smoke";
const SMOKE_PORT = 31080;

function containerCli(): string {
  const cli = Bun.which("docker") ?? Bun.which("podman");
  if (!cli) throw new Error("docker-build step needs `docker` or `podman` on PATH");
  return cli === "docker" ? "docker" : "podman";
}

async function waitForHealth(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok && ((await res.json()) as { status?: string }).status === "ok") return;
      lastErr = new Error(`healthz responded ${res.status}`);
    } catch (e) {
      lastErr = e; // container still booting — keep polling
    }
    await Bun.sleep(300);
  }
  throw new Error(`smoke step: ${url} not healthy within ${timeoutMs}ms (last: ${String(lastErr)})`);
}

export default definePipeline({
  steps: [
    {
      name: "install",
      run: async (ctx) => {
        await ctx.shell("bun install");
      },
    },
    {
      name: "test",
      dependsOn: ["install"],
      run: async (ctx) => {
        await ctx.shell("bun test");
      },
    },
    {
      name: "docker-build",
      dependsOn: ["test"],
      retries: 1,
      run: async (ctx) => {
        const cli = containerCli();
        ctx.logger.info(`building image with ${cli}`);
        await ctx.shell(`${cli} build -t ${IMAGE} .`);
      },
    },
    {
      name: "smoke",
      dependsOn: ["docker-build"],
      retries: 2,
      run: async (ctx) => {
        const cli = containerCli();
        // clean slate from any earlier run, ignore missing-container errors
        await ctx.shell(`${cli} rm -f ${CONTAINER} || true`);
        const runExit = await ctx.shell(
          `${cli} run -d --name ${CONTAINER} -p ${SMOKE_PORT}:3000 ${IMAGE}`,
        );
        if (runExit !== 0) throw new Error("smoke step: failed to start container");
        try {
          await waitForHealth(`http://localhost:${SMOKE_PORT}/healthz`);
          ctx.logger.info(`container healthy on :${SMOKE_PORT} — smoke OK`);
        } finally {
          await ctx.shell(`${cli} rm -f ${CONTAINER}`);
        }
      },
    },
  ],
});
