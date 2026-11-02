import { spawn, spawnSync } from "node:child_process";
import { constants, setPriority } from "node:os";

// Agents' shell commands, with guard rails (an agent once froze the human's
// PC with a detached PDF-conversion job the Stop button couldn't reach):
// - commands run at below-normal priority so the PC stays responsive;
// - on timeout or Stop, the whole process tree is killed, not just the shell;
// - commands that detach processes (to outlive the time limit) are refused;
// - installing heavy machine-learning packages or downloading models is
//   refused until the human approves it.

const MAX_OUTPUT = 10 * 1024 * 1024;

// Ways to start a process that outlives the command (and the Stop button).
const DETACHING: [RegExp, string][] = [
  [/\bStart-Process\b|\bStart-Job\b|\bsaps\b/i, "Start-Process/Start-Job"],
  [/(^|[;&|(]\s*)(cmd(\.exe)?\s+\/c\s+)?start\s/i, "start"],
  [/Win32_Process|\bwmic\b|Invoke-(CimMethod|WmiMethod)/i, "WMI process creation"],
  [/\bschtasks\b|Register-ScheduledTask/i, "scheduled tasks"],
  [/\bnohup\b|\bsetsid\b|\bdisown\b/, "nohup/setsid/disown"],
  [/\bpythonw(\.exe)?\b/i, "pythonw"],
  [/[^&]&\s*$/, "a trailing & (background job)"]
];

// Packages that pull in GPU/ML runtimes and multi-GB model downloads.
const HEAVY_PACKAGES =
  /\b(torch|torchvision|torchaudio|tensorflow(-\w+)?|jax|jaxlib|keras|transformers|diffusers|accelerate|sentence-transformers|marker-pdf|surya-ocr|docling|easyocr|paddleocr|paddlepaddle|onnxruntime-gpu|vllm|llama-cpp-python|xformers|bitsandbytes)\b/i;
const INSTALL = /\b(pip3?|uv\s+pip|conda|mamba|poetry\s+add|npm\s+(i|install|add)|pnpm\s+add|yarn\s+add)\b/i;
const MODEL_DOWNLOAD = /huggingface-cli\s+download|\bhf\s+download|snapshot_download|ollama\s+pull/i;

// Returns why a command is refused, or null if it may run.
export function refuseCommand(command: string): string | null {
  for (const [pattern, what] of DETACHING) {
    if (pattern.test(command)) {
      return `Refused: commands may not detach processes (${what}). Everything you run must finish inside run_command so the human's Stop button can end it. Split long work into smaller steps that each finish in time.`;
    }
  }
  if ((INSTALL.test(command) && HEAVY_PACKAGES.test(command)) || MODEL_DOWNLOAD.test(command)) {
    return "Refused: installing machine-learning packages or downloading models needs the human's approval first (they can take gigabytes of disk and all of the PC's CPU and memory). Use a lightweight approach, or explain in your report what you need, why, and the expected download size and run time.";
  }
  return null;
}

// Kills a process and all its children.
function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

export async function runCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = 60_000
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const refused = refuseCommand(command);
  if (refused) return { stdout: "", stderr: refused, exitCode: 126 };
  if (signal?.aborted) return { stdout: "", stderr: "Stopped by the human.", exitCode: 130 };

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      // Its own process group on Linux/macOS, so the whole tree can be killed.
      detached: process.platform !== "win32"
    });

    // On Windows, children of a below-normal process inherit its priority.
    if (child.pid) {
      try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not permitted */ }
    }

    let stdout = "", stderr = "";
    let ended: "timeout" | "stopped" | null = null;
    const append = (text: string, chunk: Buffer) => (text.length < MAX_OUTPUT ? text + chunk.toString() : text);
    child.stdout?.on("data", (c: Buffer) => { stdout = append(stdout, c); });
    child.stderr?.on("data", (c: Buffer) => { stderr = append(stderr, c); });

    const stop = (why: "timeout" | "stopped") => {
      if (ended || !child.pid) return;
      ended = why;
      killTree(child.pid);
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const onAbort = () => stop("stopped");
    signal?.addEventListener("abort", onAbort, { once: true });

    let settled = false;
    const finish = (code: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (ended === "timeout") {
        resolve({ stdout, stderr: `${stderr}\nCommand timed out after ${timeoutMs / 1000}s and was stopped, along with everything it started.`.trim(), exitCode: 124 });
      } else if (ended === "stopped") {
        resolve({ stdout, stderr: `${stderr}\nStopped by the human.`.trim(), exitCode: 130 });
      } else {
        resolve({ stdout, stderr: error ? error.message : stderr, exitCode: code ?? 1 });
      }
    };
    child.on("error", (error) => finish(1, error));
    child.on("close", (code) => finish(code));
  });
}
