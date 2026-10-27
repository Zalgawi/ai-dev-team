import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export async function git(
  args: string[],
  cwd: string
): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    });

    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error: any) {
    return {
      ok: false,
      stdout: String(error.stdout ?? "").trim(),
      stderr: String(error.stderr ?? error.message ?? "").trim()
    };
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return (await git(["rev-parse", "--is-inside-work-tree"], cwd)).ok;
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).stdout;
}

export function isProtectedBranch(branch: string): boolean {
  return branch === "main" || branch === "master";
}

// True when tracked files have no uncommitted changes. Untracked files are
// ignored because they follow along when switching branches.
export async function hasCleanTrackedFiles(cwd: string): Promise<boolean> {
  const status = await git(["status", "--porcelain", "--untracked-files=no"], cwd);
  return status.ok && status.stdout === "";
}

// Switches to the branch, creating it from the current HEAD if needed.
export async function checkoutBranch(
  cwd: string,
  branch: string
): Promise<GitResult> {
  const exists = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd);

  return exists.ok
    ? git(["checkout", branch], cwd)
    : git(["checkout", "-b", branch], cwd);
}

// Commits everything under pathspec. Returns false when there was nothing to commit.
export async function commitPath(
  cwd: string,
  pathspec: string,
  message: string
): Promise<boolean> {
  await git(["add", "--all", "--", pathspec], cwd);

  const staged = await git(["diff", "--cached", "--quiet", "--", pathspec], cwd);
  if (staged.ok) return false;

  const result = await git(["commit", "-m", message, "--", pathspec], cwd);
  if (!result.ok) throw new Error(result.stderr || "git commit failed");

  return true;
}
