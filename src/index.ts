import { DeveloperAgent } from "./agents/developer/developer.js";

const developer = new DeveloperAgent();

await developer.run({
  projectPath: "./projects/trail-100",
  taskId: "TASK-001",
  iteration: 1
});