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