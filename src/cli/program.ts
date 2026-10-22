import { CliConfig, Command, Options } from "@effect/cli";
import { BunContext } from "@effect/platform-bun";
import { Effect, Option } from "effect";
import { executeRun } from "./run-command.ts";

const runCommand = Command.make(
  "run",
  {
    from: Options.optional(
      Options.text("from").pipe(Options.withDescription("rerun this step and everything downstream of it"))
    ),
    force: Options.boolean("force").pipe(Options.withDescription("ignore the cache and rerun all steps")),
  },
  ({ from, force }) =>
    Effect.promise(async () => {
      process.exitCode = await executeRun(Option.isSome(from) ? from.value : undefined, force);
    })
);

const rootCommand = Command.make("bunsai", {}, () => Effect.void).pipe(Command.withSubcommands([runCommand]));

export const cli = Command.run(rootCommand, {
  name: "bunsai",
  version: "0.1.0",
});

/** Run the CLI for one argv and return the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    await Effect.runPromise(
      cli(argv).pipe(Effect.provide(BunContext.layer), Effect.provide(CliConfig.layer()))
    );
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (err) {
    // ValidationError from @effect/cli already renders usage; anything else gets a plain message
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    return 1;
  }
}