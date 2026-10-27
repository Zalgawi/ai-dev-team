import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type {
  Agent,
  AgentContext,
  AgentResult
} from "../agents/types.js";
import { AgentStoppedError } from "../llm/client.js";
import type { TaskPlan } from "../manager/planner.js";

// Stand-in agents for demo mode. They follow the same steps and write the
// same report files as the real team, but make no model calls and change no
// source files, so the office can be tried without using any Claude usage.

export interface DemoOptions {
  // Milliseconds per simulated tool call.
  stepMs?: number;
  random?: () => number;
}

// Rejects as soon as the stop button is pressed, like a real agent would.
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AgentStoppedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AgentStoppedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const ISSUES = [
  "The new control has no accessible name.",
  "Content overflows horizontally at 360px.",
  "An empty input shows every result instead of a hint.",
  "Keyboard focus outline is not visible.",
  "An existing e2e test fails after the change."
];

async function act(
  context: AgentContext,
  steps: string[],
  stepMs: number
): Promise<void> {
  for (const step of steps) {
    context.onActivity?.(step);
    await sleep(stepMs, context.signal);
  }
}

export async function demoPlan(
  request: string,
  context: Pick<AgentContext, "onActivity" | "signal">,
  { stepMs = 2500 }: DemoOptions = {}
): Promise<TaskPlan> {
  await act(context as AgentContext, ["read_file PRD.md", "read_file AGENTS.md", "list_files"], stepMs);

  const title = request.trim().replace(/\s+/g, " ").slice(0, 80);
  const large = /data|api|offline|sync|account|refactor|architecture|map/i.test(request);
  const design = /logo|icon|thumbnail|poster|banner|graphic|mockup|social post|design/i.test(request);

  return {
    title,
    description: request.trim(),
    priority: "medium",
    size: large ? "large" : "small",
    role: design ? "designer" : "developer",
    acceptanceCriteria: [
      `${title} works with mouse, touch and keyboard.`,
      "Layout works at 360px and 1280px.",
      "Automated tests cover the new behaviour.",
      "Existing features and tests keep working; npm test passes."
    ]
  };
}

export class DemoDeveloper implements Agent {
  constructor(
    public name: string,
    private options: DemoOptions = {}
  ) {}

  async run(context: AgentContext): Promise<AgentResult> {
    const stepMs = this.options.stepMs ?? 2500;
    const fixing = context.iteration > 1;

    await act(
      context,
      [
        "read_file PRD.md",
        `read_file .ai/tasks/${context.taskId}.json`,
        ...(fixing ? ["read_file .ai/qa-report.json"] : ["list_files"]),
        "write_file src/app.js",
        "write_file tests/feature.test.js",
        "run_command npm test"
      ],
      stepMs
    );

    return {
      agent: this.name,
      status: "completed",
      summary: `Demo run, no files changed.\n\n1. ${fixing ? "Fixed the issues in .ai/qa-report.json" : "Implemented the task"} in src/app.js.\n2. Ran npm test: passed.\n3. ${fixing ? "Addressed every reported QA issue." : "No QA issues yet."}\n4. Nothing outstanding.`,
      nextAction: "qa"
    };
  }
}

export class DemoQA implements Agent {
  name = "QA";

  constructor(private options: DemoOptions = {}) {}

  async run(context: AgentContext): Promise<AgentResult> {
    const stepMs = this.options.stepMs ?? 2500;
    const random = this.options.random ?? Math.random;

    await act(
      context,
      [
        "read_file PRD.md",
        `read_file .ai/tasks/${context.taskId}.json`,
        "list_files",
        "run_command npm test",
        "run_command npm run test:e2e"
      ],
      stepMs
    );

    const passChance = 0.45 + 0.15 * (context.iteration - 1);
    const passed = random() < passChance;
    const issues = passed
      ? []
      : ISSUES.filter((_, i) => i === Math.floor(random() * ISSUES.length) || i === context.iteration % ISSUES.length);

    const report = {
      taskId: context.taskId,
      outcome: passed ? "passed" : "failed",
      summary: `Demo QA round ${context.iteration}.`,
      issues: passed ? ["None"] : issues,
      tests: ["npm test (demo)", "npm run test:e2e (demo)"]
    };

    const reportPath = path.join(context.projectPath, ".ai", "qa-report.json");
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

    return {
      agent: this.name,
      status: passed ? "completed" : "failed",
      summary: report.summary,
      qaOutcome: passed ? "passed" : "failed",
      ...(passed ? {} : { issues })
    };
  }
}
