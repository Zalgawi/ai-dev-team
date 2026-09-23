import { ManagerAgent } from "../../../src/agents/manager/manager.js";
import { DeveloperAgent } from "../../../src/agents/developer/developer.js";
import { QAAgent } from "../../../src/agents/qa/qa.js";

import { createOrchestrator } from "../../../src/orchestration/workflow.js";

const manager = new ManagerAgent();
const developer = new DeveloperAgent();
const qa = new QAAgent();

const orchestrator = createOrchestrator([
  manager,
  developer,
  qa
]);

const context = {
  projectPath: "./projects/trail-100",
  taskId: "TASK-001",
  iteration: 1
};

await orchestrator.run(context);