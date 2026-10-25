import "dotenv/config";

import { ManagerAgent } from "./manager/manager.js";
import { DeveloperAgent } from "./agents/developer/developer.js";
import { QAAgent } from "./agents/qa/qa.js";
import { Orchestrator } from "./orchestration/orchestrator.js";

// Usage: npm start -- <taskId> [projectPath]
const taskId = process.argv[2];
const projectPath = process.argv[3] ?? "./projects/trail-100";

if (!taskId) {
  console.error("Usage: npm start -- <taskId> [projectPath]");
  process.exit(1);
}

const manager = new ManagerAgent();
const developer = new DeveloperAgent();
const qa = new QAAgent();

const orchestrator = new Orchestrator(
  manager,
  developer,
  qa
);

await orchestrator.run({
  projectPath,
  taskId,
  iteration: 1
});