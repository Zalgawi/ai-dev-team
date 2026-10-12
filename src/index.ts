import "dotenv/config";

import { ManagerAgent } from "./manager/manager.js";
import { DeveloperAgent } from "./agents/developer/developer.js";
import { QAAgent } from "./agents/qa/qa.js";
import { Orchestrator } from "./orchestration/orchestrator.js";

const manager = new ManagerAgent();
const developer = new DeveloperAgent();
const qa = new QAAgent();

const orchestrator = new Orchestrator(
  manager,
  developer,
  qa
);

await orchestrator.run({
  projectPath: "./projects/trail-100",
  taskId: "TASK-001",
  iteration: 1
});