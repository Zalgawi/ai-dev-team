import type { Agent } from "../agents/types.js";
import { Orchestrator } from "./orchestrator.js";

export function createOrchestrator(agents: Agent[]): Orchestrator {
  const [manager, developer, qa] = agents;

  if (!manager || !developer || !qa) {
    throw new Error(
      "createOrchestrator requires a manager, developer, and QA agent."
    );
  }

  return new Orchestrator(manager, developer, qa);
}