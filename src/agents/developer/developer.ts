import type {
  Agent,
  AgentContext,
  AgentResult
} from "../types.js";

import { runAgent } from "../../llm/client.js";

export class DeveloperAgent implements Agent {
  name = "Developer";

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
      [
        {
          role: "system",
          content: `
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
- Read the assigned task and its acceptance criteria.
- Inspect the existing project before modifying it.
- Make the smallest sensible changes needed to complete the task.
- Run relevant checks and tests after making changes.
- If a command fails, investigate and fix the problem.
- Do not modify QA reports.
- Do not approve your own work.
- Do not claim the task is complete unless you have actually implemented it and tested it.

Work autonomously on the assigned task using your available tools.

When you are finished, provide a concise summary of:
1. What you changed
2. What tests/checks you ran
3. Whether the acceptance criteria appear to be satisfied
          `.trim()
        },
        {
          role: "user",
          content: `
You have been assigned task ${context.taskId}.

You are already inside the project root.

Your available project files and folders are relative to this directory.

Start by inspecting the project and reading:
- PRD.md
- AGENTS.md
- .ai/tasks/${context.taskId}.json

Then implement the task.

Do not stop after merely describing what should be done.
Actually make the necessary changes to the project.
          `.trim()
        }
      ]
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