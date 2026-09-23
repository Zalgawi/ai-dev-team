import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function runCommand(
  command: string,
  cwd: string
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  try {
    const {
      stdout,
      stderr
    } = await execAsync(command, {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    });

    return {
      stdout,
      stderr,
      exitCode: 0
    };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.code ?? 1
    };
  }
}