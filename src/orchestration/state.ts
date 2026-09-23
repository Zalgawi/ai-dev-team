import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

export interface ProjectState {
  project: string;
  phase: string;
  iteration: number;
  status: "idle" | "running" | "completed" | "failed" | "blocked";
  currentTask: string | null;
  agents: {
    manager: string;
    developer: string;
    qa: string;
  };
  qa: {
    status: "not_started" | "running" | "passed" | "failed";
    issues: string[];
  };
}

const DEFAULT_STATE: ProjectState = {
  project: "",
  phase: "planning",
  iteration: 0,
  status: "idle",
  currentTask: null,
  agents: {
    manager: "idle",
    developer: "idle",
    qa: "idle"
  },
  qa: {
    status: "not_started",
    issues: []
  }
};

function getStatePath(projectPath: string): string {
  return path.join(projectPath, ".ai", "state.json");
}

export async function readState(projectPath: string): Promise<ProjectState> {
  const statePath = getStatePath(projectPath);

  try {
    const content = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<ProjectState>;

    return {
      ...DEFAULT_STATE,
      ...parsed,
      agents: {
        ...DEFAULT_STATE.agents,
        ...(parsed.agents ?? {})
      },
      qa: {
        ...DEFAULT_STATE.qa,
        ...(parsed.qa ?? {})
      }
    };
  } catch {
    const fallbackState: ProjectState = {
      ...DEFAULT_STATE,
      project: path.basename(projectPath)
    };

    await writeState(projectPath, fallbackState);
    return fallbackState;
  }
}

export async function writeState(
  projectPath: string,
  state: ProjectState
): Promise<void> {
  const statePath = getStatePath(projectPath);
  const dirPath = path.dirname(statePath);

  await mkdir(dirPath, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}
