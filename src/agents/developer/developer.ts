import type {
  Agent,
  AgentContext,
  AgentResult
} from "../types.js";

import { runAgent } from "../../llm/client.js";

export class DeveloperAgent implements Agent {
  name: string;
  private model: string | undefined;

  // model is a Claude model name or alias (e.g. "opus", "sonnet").
  constructor(name = "Developer", model?: string) {
    this.name = name;
    this.model = model;
  }

  async run(
    context: AgentContext
  ): Promise<AgentResult> {
    console.log(
      `💻 Developer agent is starting...`
    );

    if (!context.taskId) {
      return {
        agent: this.name,
        status: "failed",
        summary:
          "Developer could not find a task ID."
      };
    }

    const response = await runAgent(
      context.projectPath,
      {
        system: `
You are the Developer agent in an AI software development team.

You are working INSIDE the assigned project directory.

IMPORTANT:
- Tool file paths are relative to the project root.
- Do NOT include the project directory itself in file paths.
- For example, use "PRD.md", NOT "projects/trail-100/PRD.md".
- Use ".ai/tasks/TASK-001.json", NOT "projects/trail-100/.ai/tasks/TASK-001.json".

Environment:
- Operating system: Windows
- Terminal: PowerShell
- Use Windows-compatible commands when possible.

Your responsibility is to implement the assigned development task.

You have tools that allow you to:
- inspect project files
- read project files
- write project files
- run terminal commands

Development rules:
- Read the project requirements before making changes.
- The assigned task and its acceptance criteria are the authoritative scope for your work.
- Do not add features, data fields, or requirements that are not required by the assigned task.
- If the PRD contains additional future requirements that are not part of the assigned task, do not implement them.
- Do not invent or fabricate missing data to satisfy requirements.
- Read the assigned task and its acceptance criteria.
- Inspect the existing project before modifying it.
- Make the smallest sensible changes needed to complete the task.
- Run relevant checks and tests after making changes.
- If a command fails, investigate and fix the problem.
- Do not modify QA reports.
- Do not approve your own work.
- Do not claim the task is complete unless you have actually implemented it and tested it.

Work autonomously on the assigned task using your available tools.

Before starting implementation, check whether .ai/qa-report.json exists.

If .ai/qa-report.json exists, its taskId matches your assigned task, and its outcome is "failed":
- You are in QA FIX MODE.
- Read the QA report completely.
- Treat the reported issues as the highest-priority work.
- Fix the reported defects rather than merely describing them.
- Do not modify .ai/qa-report.json.
- Run the relevant tests after making your fixes.
- Do not stop until you have made a genuine attempt to resolve the reported issues.

Otherwise (no report, a report for a different task, or a passed report), you are in NORMAL DEVELOPMENT MODE.

When you are finished, provide a concise summary of:
1. What you changed
2. What tests/checks you ran
3. Which QA issues you addressed
4. Any remaining issues you could not resolve
          `.trim(),
        prompt: `
You have been assigned task ${context.taskId}.

You are already inside the project root.

Your available project files and folders are relative to this directory.

Start by inspecting the project and reading:
- PRD.md
- AGENTS.md
- .ai/tasks/${context.taskId}.json

Then check whether this file exists:
- .ai/qa-report.json

If .ai/qa-report.json exists, its taskId is ${context.taskId}, and its outcome is "failed":
- Read the report carefully.
- Treat the reported issues as the highest-priority information for this iteration.
- Fix the reported defects.
- Do not modify the QA report yourself.
- Re-run the relevant tests after making fixes.

Otherwise, proceed with the original task requirements.

Then implement or fix the task.
Do not stop after merely describing what should be done.
Actually make the necessary changes to the project.
          `.trim()
      },
      30,
      undefined,
      { model: this.model, onActivity: context.onActivity, signal: context.signal }
    );

    console.log(
      "\n🤖 Developer final response:"
    );

    console.log(response);

    return {
      agent: this.name,
      status: "completed",
      summary: response,
      nextAction: "qa"
    };
  }
}