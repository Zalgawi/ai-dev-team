import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import * as path from "node:path";

export interface TaskFile {
  id: string;
  title: string;
  description: string;
  status: string;
  assignedTo: string;
  priority: string;
  acceptanceCriteria: string[];
  request?: string;
  // Uploaded files the human attached to the request (see media.ts).
  media?: { file: string; kind: string; note?: string }[];
  humanFeedback?: { time: string; notes: string }[];
  [key: string]: unknown;
}

export interface ProjectSummary {
  name: string;
  phase: string;
  status: string;
  currentTask: string | null;
  taskCount: number;
}

export interface ProjectDetail extends ProjectSummary {
  prd: string;
  state: Record<string, unknown> | null;
  tasks: TaskFile[];
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const TASK_PATTERN = /^TASK-(\d{3,})$/;

export class ProjectError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function toProjectName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function assertTaskId(taskId: string): void {
  if (!TASK_PATTERN.test(taskId)) {
    throw new ProjectError(`"${taskId}" is not a task ID like TASK-007.`);
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

// All project files live under one root directory, one folder per project.
export class ProjectStore {
  constructor(public root: string) {}

  projectPath(name: string): string {
    if (!NAME_PATTERN.test(name)) {
      throw new ProjectError(
        "Project names use 2–40 lowercase letters, numbers and dashes.",
        400
      );
    }

    const full = path.resolve(this.root, name);

    if (path.dirname(full) !== path.resolve(this.root)) {
      throw new ProjectError("Invalid project name.", 400);
    }

    return full;
  }

  async requireProject(name: string): Promise<string> {
    const full = this.projectPath(name);

    if (!(await exists(full))) {
      throw new ProjectError(`There is no project called "${name}".`, 404);
    }

    return full;
  }

  async list(): Promise<ProjectSummary[]> {
    await mkdir(this.root, { recursive: true });

    const entries = await readdir(this.root, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isDirectory() && NAME_PATTERN.test(e.name))
      .map((e) => e.name)
      .sort();

    return Promise.all(names.map((name) => this.summary(name)));
  }

  private async summary(name: string): Promise<ProjectSummary> {
    const full = this.projectPath(name);
    const state = await readJson<Record<string, unknown>>(
      path.join(full, ".ai", "state.json")
    );
    const tasks = await this.taskIds(name);

    return {
      name,
      phase: String(state?.phase ?? "planning"),
      status: String(state?.status ?? "idle"),
      currentTask: (state?.currentTask as string | null | undefined) ?? null,
      taskCount: tasks.length
    };
  }

  async get(name: string): Promise<ProjectDetail> {
    const full = await this.requireProject(name);
    const summary = await this.summary(name);
    const state = await readJson<Record<string, unknown>>(
      path.join(full, ".ai", "state.json")
    );

    let prd = "";
    try {
      prd = await readFile(path.join(full, "PRD.md"), "utf-8");
    } catch {
      // A project without a PRD still works; the Manager will say so.
    }

    const tasks: TaskFile[] = [];
    for (const id of await this.taskIds(name)) {
      const task = await this.readTask(name, id);
      if (task) tasks.push(task);
    }

    return { ...summary, prd, state, tasks };
  }

  async create(name: string, description: string): Promise<ProjectSummary> {
    const full = this.projectPath(name);

    if (await exists(full)) {
      throw new ProjectError(`A project called "${name}" already exists.`, 409);
    }

    const brief = description.trim() || "Describe what this project should do.";

    await mkdir(path.join(full, ".ai", "tasks"), { recursive: true });

    await writeFile(
      path.join(full, "PRD.md"),
      `# ${name}\n\n## Overview\n\n${brief}\n\n## Requirements\n\nThe Manager turns each request into a task in .ai/tasks with acceptance criteria.\n`,
      "utf-8"
    );

    await writeFile(
      path.join(full, "AGENTS.md"),
      `# ${name} Project Rules\n\n## Architecture\n\nPrefer simple, maintainable solutions.\n\nAvoid unnecessary dependencies.\n\n## Testing\n\nCore user flows must have automated tests.\n\n\`npm test\` must run the project's tests. If the project has no package.json yet, the first task sets one up.\n`,
      "utf-8"
    );

    await writeFile(
      path.join(full, ".ai", "state.json"),
      `${JSON.stringify(
        {
          project: name,
          phase: "planning",
          iteration: 0,
          status: "idle",
          currentTask: null,
          agents: { manager: "idle", developer: "idle", qa: "idle" },
          qa: { status: "not_started", issues: [] }
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    return this.summary(name);
  }

  async delete(name: string): Promise<void> {
    const full = await this.requireProject(name);

    await rm(full, { recursive: true, force: true });
  }

  async taskIds(name: string): Promise<string[]> {
    const dir = path.join(this.projectPath(name), ".ai", "tasks");

    try {
      return (await readdir(dir))
        .map((f) => f.replace(/\.json$/, ""))
        .filter((id) => TASK_PATTERN.test(id))
        .sort();
    } catch {
      return [];
    }
  }

  async nextTaskId(name: string): Promise<string> {
    const numbers = (await this.taskIds(name)).map((id) =>
      Number(TASK_PATTERN.exec(id)?.[1] ?? 0)
    );
    const next = Math.max(0, ...numbers) + 1;

    return `TASK-${String(next).padStart(3, "0")}`;
  }

  async readTask(name: string, taskId: string): Promise<TaskFile | null> {
    assertTaskId(taskId);

    return readJson<TaskFile>(
      path.join(this.projectPath(name), ".ai", "tasks", `${taskId}.json`)
    );
  }

  async writeTask(name: string, task: TaskFile): Promise<void> {
    assertTaskId(task.id);

    const dir = path.join(this.projectPath(name), ".ai", "tasks");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${task.id}.json`),
      `${JSON.stringify(task, null, 2)}\n`,
      "utf-8"
    );
  }

  async updateTask(
    name: string,
    taskId: string,
    changes: Partial<TaskFile>
  ): Promise<TaskFile> {
    const task = await this.readTask(name, taskId);

    if (!task) {
      throw new ProjectError(`${taskId} does not exist in ${name}.`, 404);
    }

    const updated = { ...task, ...changes } as TaskFile;
    await this.writeTask(name, updated);
    return updated;
  }

  // Reads a file the team wrote under the project's .ai folder.
  async readAiFile(name: string, relative: string): Promise<string> {
    const full = await this.requireProject(name);
    const aiDir = path.join(full, ".ai");
    const target = path.resolve(full, relative);

    if (!target.startsWith(aiDir + path.sep)) {
      throw new ProjectError("Only files inside the project's .ai folder can be opened.", 403);
    }

    try {
      return await readFile(target, "utf-8");
    } catch {
      throw new ProjectError(`${relative} does not exist.`, 404);
    }
  }
}
