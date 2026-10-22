/**
 * ctx.shell implementation: run a command under `sh -c` via Bun.spawn with
 * inherited stdio (user sees output live), the step's cwd and env.
 * Returns the exit code (0) on success; throws a plain Error naming the step
 * on non-zero exit so the runner's retry logic can pick it up.
 */
export function makeShell(
  stepName: string,
  cwd: string,
  env: Record<string, string | undefined>
): (cmd: string) => Promise<number> {
  return async (cmd: string): Promise<number> => {
    const proc = Bun.spawn({
      cmd: ["sh", "-c", cmd],
      cwd,
      env,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`step "${stepName}" failed: command \`${cmd}\` exited with code ${code}`);
    }
    return code;
  };
}
