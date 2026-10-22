import { appInfo, startServer } from "./server.ts";
import { expect, test } from "bun:test";

test("appInfo returns healthy payload", () => {
  const info = appInfo();
  expect(info.ok).toBe(true);
  expect(info.name).toBe("bunsai-example-docker-app");
});

test("GET /healthz answers 200 ok", async () => {
  const server = startServer(0); // ephemeral port
  const res = await fetch(`http://localhost:${server.port}/healthz`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { status: string; ok: boolean };
  expect(body.status).toBe("ok");
  expect(body.ok).toBe(true);
  server.stop(true);
});

test("unknown path answers 404", async () => {
  const server = startServer(0);
  const res = await fetch(`http://localhost:${server.port}/nope`);
  expect(res.status).toBe(404);
  server.stop(true);
});
