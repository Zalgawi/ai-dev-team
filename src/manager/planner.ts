import { runAgent, type RunOptions } from "../llm/client.js";

export type TaskSize = "auto" | "small" | "large";

export interface TaskPlan {
  title: string;
  description: string;
  priority: string;
  size: "small" | "large";
  acceptanceCriteria: string[];
}

// Pulls the task plan out of the Manager's final answer, which may wrap the
// JSON in prose or a code fence.
export function parseTaskPlan(response: string): TaskPlan {
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");

  if (start === -1 || end <= start) {
    throw new Error("The Manager did not return a task as JSON.");
  }

  const raw = JSON.parse(response.slice(start, end + 1)) as Partial<TaskPlan>;
  const criteria = Array.isArray(raw.acceptanceCriteria)
    ? raw.acceptanceCriteria.map(String).filter((c) => c.trim())
    : [];

  if (!raw.title || !criteria.length) {
    throw new Error("The Manager's task is missing a title or acceptance criteria.");
  }

  return {
    title: String(raw.title),
    description: String(raw.description ?? raw.title),
    priority: ["low", "medium", "high"].includes(String(raw.priority))
      ? String(raw.priority)
      : "medium",
    size: raw.size === "large" ? "large" : "small",
    acceptanceCriteria: criteria
  };
}

// The Manager reads the project and turns a plain-language request into a
// task with acceptance criteria. It only has read tools.
export async function planTask(
  projectPath: string,
  taskId: string,
  request: string,
  options: RunOptions = {}
): Promise<TaskPlan> {
  const response = await runAgent(
    projectPath,
    {
      system: `
You are the Manager agent in an AI software development team.

You turn a request from the human into one development task with clear,
testable acceptance criteria. You do not write code.

You are working INSIDE the project directory. Tool file paths are relative
to the project root (e.g. "PRD.md", ".ai/tasks/TASK-001.json").

Process:
1. Read PRD.md and AGENTS.md if they exist.
2. List the project files once and read one or two existing task files in
   .ai/tasks to match their style, if there are any.
3. Write the task.

Rules:
- Keep the task scoped to the request. Do not add unrelated features.
- Acceptance criteria must be specific and verifiable by QA, including
  automated tests and "existing features and tests keep working".
- If the project has no package.json or tests yet, include setting up
  \`npm test\` in the criteria.
- size is "large" for multi-file features, data or architecture changes;
  otherwise "small".

Your final response must be ONLY a JSON object with this shape and nothing else:
{"title": "...", "description": "...", "priority": "low|medium|high", "size": "small|large", "acceptanceCriteria": ["...", "..."]}
`.trim(),
      prompt: `Create task ${taskId} for this request:\n\n${request}`
    },
    8,
    ["read_file", "list_files"],
    options
  );

  return parseTaskPlan(response);
}
