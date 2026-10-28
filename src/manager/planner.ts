import { runAgent, type RunOptions } from "../llm/client.js";

// "design", "video" and "quant" send the task to the Designer, Video Editor
// and Quant Advisor; small/large go to the Jr/Senior Dev.
export type TaskSize = "auto" | "small" | "large" | "design" | "video" | "quant";
export type TaskRole = "developer" | "designer" | "video-editor" | "quant-advisor";

export interface TaskPlan {
  title: string;
  description: string;
  priority: string;
  size: "small" | "large";
  role: TaskRole;
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
    role: raw.role === "designer" || raw.role === "video-editor" || raw.role === "quant-advisor" ? raw.role : "developer",
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
You are the Manager agent in an AI software development team. The team has
developers (who write code) and a graphic/UI designer (who makes logos,
social graphics, thumbnails, posters, banners and UI mockups as HTML/SVG
rendered to PNG; it cannot generate photos) and a video editor (who
edits uploaded footage into finished videos with ffmpeg; it can see frames
but can't hear, so it follows the human's notes for what is said) and a
quant advisor (who answers financial and mathematical/logical strategy
questions with tested code, charts and a written report; research and
education, not personal financial advice, and it never trades).

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
- role is "designer" when the deliverable is a graphic or visual design
  (logo, icon, social post, thumbnail, poster, banner, mockup); otherwise
  "developer". For designer tasks, write criteria QA can check by looking
  at the exported PNGs: exact pixel sizes, required text spelled exactly,
  readability at small sizes, contrast, brand colours, use of any attached
  images. Don't ask for npm tests unless code changes.
- role is "video-editor" when the deliverable is an edited video made from
  uploaded footage (reels, shorts, TikToks, trailers, highlight cuts). Its
  criteria: output format (default vertical 1080×1920, H.264/AAC MP4),
  target length, the order and moments to use or cut as the request and the
  clip notes say, any on-screen text spelled exactly, loudness about
  -14 LUFS, and an edit plan in video/<name>-edit.md. Don't ask for npm
  tests unless code changes.
- role is "quant-advisor" when the deliverable is financial or quantitative
  analysis: strategy research and backtests, portfolio, risk or position
  sizing, option/bond pricing, loan, savings or retirement maths, or a
  probability, game-theory or logic problem (including a tool that computes
  these). Its criteria: the question answered with numbers and their
  uncertainty; assumptions and conventions stated; code and passing tests
  in research/<name>/; results cross-checked by a second method; for
  backtests, no look-ahead, costs included and an out-of-sample period;
  a report in research/<name>-report.md with a not-personal-advice note,
  risks and limitations; charts as media/chart-<name>.png where they help.
  Don't ask for npm tests unless the project has them.
- Output locations are fixed by the team's tools; use them exactly and
  never name other paths for media files: final videos are
  media/video-<name>.mp4, design exports are media/design-<name>.png,
  charts are media/chart-<name>.png (media/ stays off git), edit plans are
  video/<name>-edit.md, design sources are in design/, quant code and
  reports are in research/.
- If files are attached to the request, say in the description how each
  should be used, and copy any timestamped instructions from their notes.

Your final response must be ONLY a JSON object with this shape and nothing else:
{"title": "...", "description": "...", "priority": "low|medium|high", "size": "small|large", "role": "developer|designer|video-editor|quant-advisor", "acceptanceCriteria": ["...", "..."]}
`.trim(),
      prompt: `Create task ${taskId} for this request:\n\n${request}`
    },
    8,
    ["read_file", "list_files"],
    options
  );

  return parseTaskPlan(response);
}
