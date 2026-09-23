import OpenAI from "openai";

import { openrouter } from "./openrouter.js";
import {
  llmTools,
  executeTool
} from "./tools.js";

type LLMMessage =
  OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function runAgent(
  projectPath: string,
  messages: LLMMessage[]
): Promise<string> {
  const conversation: LLMMessage[] = [...messages];

  for (let iteration = 0; iteration < 20; iteration++) {
    console.log(
      `🧠 LLM iteration ${iteration + 1}`
    );

    const response =
      await openrouter.chat.completions.create({
        model: "openrouter/free",
        messages: conversation,
        tools: llmTools,
        tool_choice: "auto",
        max_tokens: 4000
      });

    const message =
      response.choices[0]?.message;

    if (!message) {
      throw new Error(
        "LLM returned no message."
      );
    }

    conversation.push(message);

    if (!message.tool_calls?.length) {
      return message.content ?? "";
    }

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") {
        throw new Error(
          `Unsupported tool call type: ${toolCall.type}`
        );
      }

      console.log(
        `🔧 Tool requested: ${toolCall.function.name}`
      );

      const result = await executeTool(
        toolCall.function.name,
        toolCall.function.arguments,
        projectPath
      );

      console.log(
        `   ✓ Tool completed`
      );

      conversation.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result
      });
    }
  }

  throw new Error(
    "LLM exceeded the maximum number of tool iterations."
  );
}