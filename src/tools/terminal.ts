import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function runCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
      killSignal: "SIGTERM",
      ...(signal ? { signal } : {})
    });

    return {
      stdout,
      stderr,
      exitCode: 0
    };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? "",
      stderr:
        error.stderr ??
        error.message ??
        "Command timed out or failed.",
      exitCode:
        error.code === "ETIMEDOUT"
          ? 124
          : error.code ?? 1
    };
  }
}