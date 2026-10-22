const PORT = Number(process.env.PORT ?? 3000);

export type AppInfo = {
  name: string;
  version: string;
  ok: boolean;
};

export function appInfo(): AppInfo {
  return { name: "bunsai-example-docker-app", version: "0.1.0", ok: true };
}

export function startServer(port = PORT) {
  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/healthz") {
        return Response.json({ status: "ok", ...appInfo() });
      }
      if (url.pathname === "/") {
        return Response.json({ hello: "bunsai", ...appInfo() });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

// entrypoint: only start when run directly (not under `bun test`)
if (import.meta.main) {
  const server = startServer();
  console.log(`listening on http://localhost:${server.port}`);
}
