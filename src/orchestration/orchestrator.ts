import type {
  Agent,
  AgentContext,
  AgentResult
} from "../agents/types.js";

import { readState, writeState } from "./state.js";

export class Orchestrator {
  private manager: Agent;
  private developer: Agent;
  private qa: Agent;

  constructor(
    manager: Agent,
    developer: Agent,
    qa: Agent
  ) {
    this.manager = manager;
    this.developer = developer;
    this.qa = qa;
  }

  async run(
    context: AgentContext,
    maxIterations = 5
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    const state = await readState(context.projectPath);

    console.log("\n📊 Project state loaded:");
    console.log(`   Project: ${state.project}`);
    console.log(`   Phase: ${state.phase}`);
    console.log(`   Task: ${state.currentTask}`);
    console.log(`   Iteration: ${state.iteration}`);

    // Manager reviews the task first.
    console.log("\n📋 Manager starting...");

    const managerResult =
      await this.manager.run(context);

    results.push(managerResult);

    console.log(
      `✅ Manager: ${managerResult.status}`
    );

    if (managerResult.status === "failed") {
      return results;
    }

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

      console.log("\n💻 Developer starting...");

      const developerResult =
        await this.developer.run(
          iterationContext
        );

      results.push(developerResult);

      console.log(
        `✅ Developer: ${developerResult.status}`
      );

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

        return results;
      }

      console.log("\n🧪 QA starting...");

      state.phase = "qa";
      state.agents.qa = "running";

      await writeState(
        context.projectPath,
        state
      );

      const qaResult =
        await this.qa.run(
          iterationContext
        );

      results.push(qaResult);

      console.log(
        `✅ QA: ${qaResult.status}`
      );

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

        await writeState(
          context.projectPath,
          state
        );

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

    return results;
  }
} 