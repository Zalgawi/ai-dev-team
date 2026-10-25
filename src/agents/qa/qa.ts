import type {
  Agent,
  AgentContext,
  AgentResult
} from "../types.js";

import { runAgent } from "../../llm/client.js";
import { qaTools } from "../../llm/tools.js";
import { writeProjectFile } from "../../tools/filesystem.js";

export class QAAgent implements Agent {
  name = "QA";

  async run(
    context: AgentContext
  ): Promise<AgentResult> {
    console.log("🧪 QA agent is starting...");

    if (!context.taskId) {
      return {
        agent: this.name,
        status: "failed",
        summary: "QA could not find a task ID.",
        qaOutcome: "failed"
      };
    }

    const response = await runAgent(
      context.projectPath,
      {
        system: `
You are the QA agent in an AI software development team.

Your job is to independently verify the developer's work.

You are READ-ONLY:
- You may read files.
- You may list files.
- You may run tests and safe verification commands.
- You MUST NOT use write_file.
- You MUST NOT modify any project files.
- You MUST NOT fix bugs yourself.

Follow this verification process EXACTLY and do not repeat steps:

STEP 1 — Read requirements:
- PRD.md
- AGENTS.md
- .ai/tasks/${context.taskId}.json

STEP 2 — Inspect implementation:
List the project directory once, then read only the files directly
relevant to the task (source, data, and tests it touches).

Do NOT repeatedly list the project directory.

STEP 3 — Run the test suite:
Run:
npm test

If the command reports zero tests, that is a QA FAILURE.
Do not assume zero tests means success.

STEP 4 — Verify acceptance criteria:
Compare the implementation and test results against every acceptance criterion in the task.

STEP 5 — Stop and report.
Do not perform additional exploratory tool calls once you have enough evidence.

Your final response MUST use exactly this structure:

Your final response MUST use exactly this structure.

Do NOT use Markdown headings.
Do NOT add text before or after this structure.
Do NOT change the spelling of any labels.

Summary:
<concise summary>

Issues:
- <issue>
- <issue>

Tests:
- <test/check>
- <test/check>

QA OUTCOME: PASSED

OR

QA OUTCOME: FAILED

The QA OUTCOME line MUST be the final line of your response.

If there are no issues, write:
Issues:
- None

If any acceptance criterion cannot be verified, or any test fails, use:
QA OUTCOME: FAILED

You are an independent QA gate.
You must not modify the project.
`.trim(),
        prompt: `Verify task ${context.taskId} following the process above.`
      },
      7,
      qaTools
    );

    console.log("\n🤖 QA final response:");
    console.log(response);

const outcomeMatch = response.match(
  /QA OUTCOME:\s*(PASSED|FAILED)\s*$/im
);

const outcome =
  outcomeMatch?.[1]?.toLowerCase() ?? "failed";

const issuesSection =
  response.match(
    /Issues:\s*([\s\S]*?)(?=\n\s*Tests:|\s*$)/i
  )?.[1] ?? "";

const testsSection =
  response.match(
    /Tests:\s*([\s\S]*?)(?=\n\s*QA OUTCOME:|\s*$)/i
  )?.[1] ?? "";

const issues = issuesSection
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.startsWith("- "))
  .map(line => line.slice(2).trim());

const tests = testsSection
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.startsWith("- "))
  .map(line => line.slice(2).trim());

await writeProjectFile(
  context.projectPath,
  ".ai/qa-report.json",
  JSON.stringify(
    {
      taskId: context.taskId,
      outcome,
      summary: response,
      issues,
      tests
    },
    null,
    2
  )
);

if (!outcomeMatch) {
  return {
    agent: this.name,
    status: "failed",
    summary: response,
    qaOutcome: "failed",
    issues: [
      "QA report did not contain a valid final QA OUTCOME."
    ]
  };
}

if (outcome === "passed") {
  return {
    agent: this.name,
    status: "completed",
    summary: response,
    qaOutcome: "passed"
  };
}

return {
  agent: this.name,
  status: "failed",
  summary: response,
  qaOutcome: "failed"
};
  }
}