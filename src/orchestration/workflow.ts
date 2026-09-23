import type { Agent } from "../agents/types.js";
import { Orchestrator } from "./orchestrator.js";

export function createOrchestrator(agents: Agent[]): Orchestrator {
  return new Orchestrator(agents);
}