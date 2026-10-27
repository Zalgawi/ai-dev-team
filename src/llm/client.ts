import {
  query,
  type Options,
  type SDKResultMessage
} from "@anthropic-ai/claude-agent-sdk";

import {
  llmTools,
  createToolServer,
  qualifiedToolName,
  TOOL_SERVER_NAME,
  type ToolName
} from "./tools.js";

// Runs on the Claude Code installation's login (claude.ai subscription or
// whatever `claude auth status` reports), so no API key is needed.
// Set CLAUDE_MODEL to override the Claude Code default model.
// A per-agent model (RunOptions.model) takes precedence.
const defaultModel = process.env.CLAUDE_MODEL;

export interface AgentPrompt {
  system: string;
  prompt: string;
}

export interface RunOptions {
  model?: string | undefined;
  onActivity?: ((activity: string) => void) | undefined;
  // Stops the Claude session (and any running command) when aborted.
  signal?: AbortSignal | undefined;
}

export class AgentStoppedError extends Error {
  constructor() {
    super("Stopped by the human.");
    this.name = "AgentStoppedError";
  }
}

// The SDK takes an AbortController, so link one to the caller's signal.
function controllerFor(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController();

  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", () => controller.abort(), { once: true });

  return controller;
}

function baseOptions(
  projectPath: string,
  system: string,
  model: string | undefined
): Options {
  return {
    cwd: projectPath,
    systemPrompt: system,
    // Don't load the user's Claude Code settings, hooks, or CLAUDE.md files;
    // agents only get what is configured here.
    settingSources: [],
    // Anything not explicitly allowed is denied rather than prompting.
    permissionMode: "dontAsk",
    ...(model ? { model } : {})
  };
}

// Short, human-readable description of a tool call, e.g. "read_file PRD.md".
function describeToolUse(name: string, input: unknown): string {
  const shortName = name.replace(`mcp__${TOOL_SERVER_NAME}__`, "");
  const args = (input ?? {}) as Record<string, unknown>;
  const detail = args.filePath ?? args.command ?? "";

  return `${shortName} ${String(detail)}`.trim().slice(0, 160);
}

async function collectResult(
  run: ReturnType<typeof query>,
  onActivity?: (activity: string) => void
): Promise<{ result: SDKResultMessage; sessionId: string }> {
  // One model response can arrive as several assistant messages sharing an id.
  const seenResponses = new Set<string>();

  for await (const message of run) {
    if (message.type === "assistant") {
      if (!seenResponses.has(message.message.id)) {
        seenResponses.add(message.message.id);

        console.log(`🧠 LLM iteration ${seenResponses.size}`);
      }

      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          console.log(
            `🔧 Tool requested: ${block.name.replace(`mcp__${TOOL_SERVER_NAME}__`, "")}`
          );

          onActivity?.(describeToolUse(block.name, block.input));
        }
      }
    }

    if (message.type === "result") {
      return {
        result: message,
        sessionId: message.session_id
      };
    }
  }

  throw new Error("Claude session ended without a result.");
}

export async function runAgent(
  projectPath: string,
  { system, prompt }: AgentPrompt,
  maxIterations = 12,
  tools: ToolName[] = llmTools,
  { model = defaultModel, onActivity, signal }: RunOptions = {}
): Promise<string> {
  if (signal?.aborted) throw new AgentStoppedError();

  try {
    return await runAgentSession(projectPath, { system, prompt }, maxIterations, tools, model, onActivity, signal);
  } catch (error) {
    if (signal?.aborted) throw new AgentStoppedError();
    throw error;
  }
}

async function runAgentSession(
  projectPath: string,
  { system, prompt }: AgentPrompt,
  maxIterations: number,
  tools: ToolName[],
  model: string | undefined,
  onActivity: RunOptions["onActivity"],
  signal: AbortSignal | undefined
): Promise<string> {
  const { result, sessionId } = await collectResult(
    query({
      prompt,
      options: {
        ...baseOptions(projectPath, system, model),
        // Disable Claude Code's built-in tools; only the project tools are available.
        tools: [],
        mcpServers: {
          [TOOL_SERVER_NAME]: createToolServer(projectPath, tools, signal)
        },
        allowedTools: tools.map(qualifiedToolName),
        maxTurns: maxIterations,
        abortController: controllerFor(signal)
      }
    }),
    onActivity
  );

  if (result.subtype === "success") {
    if (result.is_error) {
      throw new Error(`Claude returned an error: ${result.result}`);
    }

    return result.result;
  }

  if (result.subtype !== "error_max_turns") {
    throw new Error(
      `Claude run failed (${result.subtype}): ${result.errors.join("; ")}`
    );
  }

  console.log(
    "⚠️ LLM reached the tool iteration limit. Requesting final report..."
  );

  // Resume the same session with no tools so it must answer from what it has gathered.
  const { result: finalResult } = await collectResult(
    query({
      prompt:
        "You have reached your tool-use limit. Do not call any more tools. Based only on the evidence gathered so far, provide your final response now. Be explicit about any uncertainty or unverified acceptance criteria.",
      options: {
        ...baseOptions(projectPath, system, model),
        resume: sessionId,
        tools: [],
        maxTurns: 1,
        abortController: controllerFor(signal)
      }
    })
  );

  return finalResult.subtype === "success"
    ? finalResult.result
    : "";
}
