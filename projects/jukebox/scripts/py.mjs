// Runs the project's Python (.venv first) with the given arguments, e.g.
//   node scripts/py.mjs -m toolkit.pipeline update
//   node scripts/py.mjs -m uvicorn app.server:app --host 127.0.0.1 --port 8050
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const isWin = process.platform === "win32";
const venv = isWin ? join(".venv", "Scripts", "python.exe") : join(".venv", "bin", "python");
const python = existsSync(venv) ? [venv] : isWin ? ["py", "-3"] : ["python3"];

const check = spawnSync(python[0], [...python.slice(1), "-c", "import pandas, fastapi, uvicorn"], { encoding: "utf8" });
if (check.status !== 0) {
  console.error(`Python packages are missing for ${python.join(" ")}.\nRun:  ${python.join(" ")} -m pip install -r requirements.txt`);
  process.exit(1);
}

const r = spawnSync(python[0], [...python.slice(1), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
