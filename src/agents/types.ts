export type AgentStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type QAOutcome =
  | "not_run"
  | "passed"
  | "failed";

export interface AgentContext {
  projectPath: string;
  taskId?: string;
  iteration: number;
  // Called with a short description of each tool the agent uses.
  onActivity?: (activity: string) => void;
  // Aborted when the human presses the stop button.
  signal?: AbortSignal;
}

export interface AgentResult {
  agent: string;
  status: AgentStatus;
  summary: string;
  filesChanged?: string[];
  issues?: string[];
  qaOutcome?: QAOutcome;
  nextAction?: string;
}

export interface Agent {
  name: string;

  run(context: AgentContext): Promise<AgentResult>;
}