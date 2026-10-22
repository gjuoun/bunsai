import { Context, Layer } from "effect";
import type { Logger } from "../types.ts";

/** Logger as an Effect service, so the runner never reaches for a global. */
export class LoggerService extends Context.Tag("bunsai/LoggerService")<LoggerService, Logger>() {}

export const defaultLogger: Logger = {
  info: (msg) => console.log(`[bunsai] ${msg}`),
  error: (msg) => console.error(`[bunsai] ${msg}`),
};

/** Provide an explicit logger (tests inject a capture logger). */
export const loggerLayer = (logger: Logger): Layer.Layer<LoggerService> => Layer.succeed(LoggerService, logger);

export const defaultLoggerLayer: Layer.Layer<LoggerService> = loggerLayer(defaultLogger);