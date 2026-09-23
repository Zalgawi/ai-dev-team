import type {
  Agent,
  AgentContext,
  AgentResult
} from "../agents/types.js";

import {
  readState,
  writeState
} from "./state.js";

export class Orchestrator {
  private agents: Agent[];

  constructor(agents: Agent[]) {
    this.agents = agents;
  }

  async run(context: AgentContext): Promise<AgentResult[]> {
    const results: AgentResult[] = [];

    const state = await readState(context.projectPath);

    console.log("\n📊 Project state loaded:");
    console.log(`   Project: ${state.project}`);
    console.log(`   Phase: ${state.phase}`);
    console.log(`   Task: ${state.currentTask}`);
    console.log(`   Iteration: ${state.iteration}`);

    for (const agent of this.agents) {
      console.log(`\n🤖 ${agent.name} starting...`);

      const result = await agent.run(context);

      results.push(result);

      console.log(`✅ ${agent.name}: ${result.status}`);
      console.log(`   ${result.summary}`);
    }

    state.status = "completed";

    await writeState(
      context.projectPath,
      state
    );

    console.log("\n💾 Project state saved.");

    return results;
  }
}