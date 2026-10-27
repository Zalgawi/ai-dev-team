import { copyFile, mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type {
  Agent,
  AgentContext,
  AgentResult
} from "../agents/types.js";

import { AgentStoppedError } from "../llm/client.js";

import type { TeamEvent, TeamEventListener } from "./events.js";
import { readState, writeState } from "./state.js";

export interface OrchestratorOptions {
  // Extra developers keyed by the task's assignedTo value
  // (e.g. "senior-developer"). Unknown values use the default developer.
  developers?: Record<string, Agent>;
  onEvent?: TeamEventListener;
}

export class Orchestrator {
  private manager: Agent;
  private developer: Agent;
  private qa: Agent;
  private developers: Record<string, Agent>;
  private onEvent: TeamEventListener;

  constructor(
    manager: Agent,
    developer: Agent,
    qa: Agent,
    options: OrchestratorOptions = {}
  ) {
    this.manager = manager;
    this.developer = developer;
    this.qa = qa;
    this.developers = options.developers ?? {};
    this.onEvent = options.onEvent ?? (() => {});
  }

  private emit(event: TeamEvent): void {
    try {
      this.onEvent(event);
    } catch (error) {
      console.error("⚠️ Event listener failed:", error);
    }
  }

  private withActivity(
    context: AgentContext,
    agent: string
  ): AgentContext {
    return {
      ...context,
      onActivity: (activity) =>
        this.emit({ type: "agent-activity", agent, activity })
    };
  }

  // Keeps each round's reports so earlier rounds aren't lost when
  // .ai/qa-report.json is overwritten.
  private async saveDevReport(
    context: AgentContext,
    iteration: number,
    result: AgentResult
  ): Promise<string | undefined> {
    if (!context.taskId) return undefined;

    const relative = `.ai/reports/${context.taskId}/round-${iteration}-dev-report.md`;
    const fullPath = path.join(context.projectPath, relative);

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(
      fullPath,
      `# Development report: ${context.taskId} (round ${iteration})\n\nDeveloper: ${result.agent}\nStatus: ${result.status}\n\n${result.summary}\n`,
      "utf-8"
    );

    return relative;
  }

  private async archiveQaReport(
    context: AgentContext,
    iteration: number
  ): Promise<string | undefined> {
    if (!context.taskId) return undefined;

    const relative = `.ai/reports/${context.taskId}/round-${iteration}-qa-report.json`;
    const fullPath = path.join(context.projectPath, relative);

    try {
      await mkdir(path.dirname(fullPath), { recursive: true });
      await copyFile(
        path.join(context.projectPath, ".ai", "qa-report.json"),
        fullPath
      );
      return relative;
    } catch {
      return undefined;
    }
  }

  // Runs the task until QA passes, the round limit is hit, or the human
  // stops it (context.signal). A stopped run ends with run-end "stopped".
  async run(
    context: AgentContext,
    maxIterations = 5
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];

    try {
      return await this.runLoop(context, maxIterations, results);
    } catch (error) {
      if (!(error instanceof AgentStoppedError) && !context.signal?.aborted) throw error;

      console.log("\n🛑 Stopped by the human.");

      const state = await readState(context.projectPath);
      state.status = "stopped";
      state.phase = "stopped";
      state.agents.developer = "idle";
      state.agents.qa = "idle";
      if (state.qa.status === "running") state.qa.status = "not_started";
      await writeState(context.projectPath, state);

      this.emit({ type: "run-end", status: "stopped", iteration: state.iteration });
      return results;
    }
  }

  private stopIfAsked(context: AgentContext): void {
    if (context.signal?.aborted) throw new AgentStoppedError();
  }

  private async runLoop(
    context: AgentContext,
    maxIterations: number,
    results: AgentResult[]
  ): Promise<AgentResult[]> {
    const state = await readState(context.projectPath);

    console.log("\n📊 Project state loaded:");
    console.log(`   Project: ${state.project}`);
    console.log(`   Phase: ${state.phase}`);
    console.log(`   Task: ${state.currentTask}`);
    console.log(`   Iteration: ${state.iteration}`);

    // Manager reviews the task first.
    console.log("\n📋 Manager starting...");
    this.emit({ type: "agent-start", agent: "manager", iteration: 0 });

    const managerResult =
      await this.manager.run(context);

    results.push(managerResult);

    console.log(
      `✅ Manager: ${managerResult.status}`
    );

    this.emit({
      type: "agent-done",
      agent: "manager",
      iteration: 0,
      status: managerResult.status
    });

    if (managerResult.status === "failed") {
      this.emit({ type: "run-end", status: "failed", iteration: 0 });
      return results;
    }

    const developerKey =
      managerResult.nextAction &&
      this.developers[managerResult.nextAction]
        ? managerResult.nextAction
        : "developer";

    const developer =
      this.developers[developerKey] ?? this.developer;

    // Developer → QA feedback loop.
    for (
      let iteration = 1;
      iteration <= maxIterations;
      iteration++
    ) {
      console.log(
        `\n🔄 Development iteration ${iteration}/${maxIterations}`
      );

      const iterationContext: AgentContext = {
        ...context,
        iteration
      };

      state.iteration = iteration;
      state.phase = "development";
      state.status = "running";
      state.currentTask = context.taskId ?? null;

      await writeState(
        context.projectPath,
        state
      );

      this.stopIfAsked(context);
      console.log("\n💻 Developer starting...");
      this.emit({ type: "agent-start", agent: developerKey, iteration });

      const developerResult =
        await developer.run(
          this.withActivity(iterationContext, developerKey)
        );

      results.push(developerResult);

      console.log(
        `✅ Developer: ${developerResult.status}`
      );

      const devReportPath = await this.saveDevReport(
        context,
        iteration,
        developerResult
      );

      this.emit({
        type: "agent-done",
        agent: developerKey,
        iteration,
        status: developerResult.status,
        ...(devReportPath ? { reportPath: devReportPath } : {})
      });

      if (
        developerResult.status === "failed"
      ) {
        console.log(
          "\n❌ Developer failed. Stopping workflow."
        );

        state.status = "failed";
        state.phase = "development";

        await writeState(
          context.projectPath,
          state
        );

        this.emit({ type: "run-end", status: "failed", iteration });
        return results;
      }

      this.stopIfAsked(context);
      console.log("\n🧪 QA starting...");

      state.phase = "qa";
      state.agents.qa = "running";
      state.qa.status = "running";

      await writeState(
        context.projectPath,
        state
      );

      this.emit({ type: "agent-start", agent: "qa", iteration });

      const qaResult =
        await this.qa.run(
          this.withActivity(iterationContext, "qa")
        );

      results.push(qaResult);

      console.log(
        `✅ QA: ${qaResult.status}`
      );

      const qaReportPath = await this.archiveQaReport(
        context,
        iteration
      );

      this.emit({
        type: "qa-result",
        iteration,
        outcome: qaResult.qaOutcome === "passed" ? "passed" : "failed",
        issues: qaResult.issues ?? [],
        ...(qaReportPath ? { reportPath: qaReportPath } : {})
      });

      if (
        qaResult.qaOutcome === "passed"
      ) {
        console.log(
          "\n🎉 QA PASSED — task complete."
        );

        state.status = "completed";
        state.phase = "completed";
        state.agents.developer = "completed";
        state.agents.qa = "completed";
        state.qa.status = "passed";
        state.qa.issues = [];

        await writeState(
          context.projectPath,
          state
        );

        this.emit({ type: "run-end", status: "completed", iteration });
        return results;
      }

      console.log(
        "\n❌ QA FAILED — returning to Developer."
      );

      state.status = "running";
      state.phase = "development";
      state.qa.status = "failed";
      state.qa.issues =
        qaResult.issues ?? [];

      await writeState(
        context.projectPath,
        state
      );
    }

    console.log(
      `\n🛑 Maximum development iterations (${maxIterations}) reached.`
    );

    state.status = "blocked";
    state.phase = "blocked";

    await writeState(
      context.projectPath,
      state
    );

    this.emit({ type: "run-end", status: "blocked", iteration: maxIterations });
    return results;
  }
}
