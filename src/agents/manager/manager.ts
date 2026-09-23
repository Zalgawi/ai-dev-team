import type {
  Agent,
  AgentContext,
  AgentResult
} from "../types.js";

import { readProjectFile } from "../../tools/filesystem.js";

export class ManagerAgent implements Agent {
  name = "Manager";

  async run(context: AgentContext): Promise<AgentResult> {
    console.log(`📋 Manager is reviewing project...`);
    console.log(`   Project: ${context.projectPath}`);
    console.log(`   Task: ${context.taskId ?? "none"}`);
    console.log(`   Iteration: ${context.iteration}`);

    if (!context.taskId) {
      return {
        agent: this.name,
        status: "failed",
        summary: "Manager could not find a task ID."
      };
    }

    const task = await readProjectFile(
      context.projectPath,
      `.ai/tasks/${context.taskId}.json`
    );

    const taskData = JSON.parse(task);

    console.log(`📋 Manager loaded task: ${taskData.title}`);
    console.log(`   Status: ${taskData.status}`);
    console.log(`   Assigned to: ${taskData.assignedTo}`);
    console.log(`   Priority: ${taskData.priority}`);

    return {
      agent: this.name,
      status: "completed",
      summary: `Manager loaded task ${taskData.id}: ${taskData.title}`,
      nextAction: taskData.assignedTo
    };
  }
}