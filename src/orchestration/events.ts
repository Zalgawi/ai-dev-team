import type { AgentStatus } from "../agents/types.js";

// Progress events emitted while a task runs. The office UI animates the
// team from these; the CLI ignores them.
export type TeamEvent =
  | {
      type: "agent-start";
      agent: string;
      iteration: number;
    }
  | {
      type: "agent-activity";
      agent: string;
      activity: string;
    }
  | {
      type: "agent-done";
      agent: string;
      iteration: number;
      status: AgentStatus;
      reportPath?: string;
    }
  | {
      type: "qa-result";
      iteration: number;
      outcome: "passed" | "failed";
      issues: string[];
      reportPath?: string;
    }
  | {
      type: "run-end";
      status: "completed" | "failed" | "blocked" | "stopped";
      iteration: number;
    };

export type TeamEventListener = (event: TeamEvent) => void;
