import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { Logger } from "../types.ts";
import { LoggerService, defaultLoggerLayer } from "./logger.ts";

describe("LoggerService", () => {
  test("provides the injected logger to the effect", async () => {
    const seen: string[] = [];
    const logger: Logger = {
      info: (msg) => seen.push("info:" + msg),
      error: (msg) => seen.push("error:" + msg),
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* LoggerService;
        log.info("hello");
        log.error("boom");
      }).pipe(Effect.provide(Layer.succeed(LoggerService, logger)))
    );
    expect(seen).toEqual(["info:hello", "error:boom"]);
  });

  test("default layer prefixes both channels with [bunsai]", async () => {
    const infos: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => { infos.push(args.map(String).join(" ")); };
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const log = yield* LoggerService;
          log.info("a");
          log.error("b");
        }).pipe(Effect.provide(defaultLoggerLayer))
      );
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    expect(infos).toEqual(["[bunsai] a"]);
    expect(errors).toEqual(["[bunsai] b"]);
  });
});