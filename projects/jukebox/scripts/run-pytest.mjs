// Runs the Python test suite (pytest) for `npm test`.
// Finds a Python 3.9+ interpreter (project .venv first, then $PYTHON, python3, python, py -3),
// checks that pytest is importable, and fails with a clear message if either is missing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const isWin = process.platform === "win32";

const candidates = [];
const venvPy = isWin ? join(root, ".venv", "Scripts", "python.exe") : join(root, ".venv", "bin", "python");
if (existsSync(venvPy)) candidates.push([venvPy]);
if (process.env.PYTHON) candidates.push([process.env.PYTHON]);
candidates.push(["python3"], ["python"]);
if (isWin) candidates.push(["py", "-3"]);

function run(cmd, args, opts = {}) {
  return spawnSync(cmd[0], [...cmd.slice(1), ...args], { encoding: "utf8", ...opts });
}

let python = null;
for (const c of candidates) {
  const r = run(c, ["-c", "import sys; print(sys.version_info >= (3, 9))"]);
  if (r.status === 0 && r.stdout.trim() === "True") {
    python = c;
    break;
  }
}

if (!python) {
  console.error(
    "npm test: no Python 3.9+ interpreter found.\n" +
      "Install Python 3.9 or newer, then run:  python -m pip install -r requirements.txt\n" +
      "(or set the PYTHON environment variable to your interpreter)."
  );
  process.exit(1);
}

const hasPytest = run(python, ["-c", "import pytest"]);
if (hasPytest.status !== 0) {
  console.error(
    `npm test: pytest is not installed for ${python.join(" ")}.\n` +
      `Run:  ${python.join(" ")} -m pip install -r requirements.txt`
  );
  process.exit(1);
}

const extra = process.argv.slice(2);
const r = run(python, ["-m", "pytest", "tests", ...extra], { stdio: "inherit" });
process.exit(r.status ?? 1);
