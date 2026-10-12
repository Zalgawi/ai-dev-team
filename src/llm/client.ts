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
  messages: LLMMessage[],
  maxIterations = 12,
  tools = llmTools
): Promise<string> {
  const conversation: LLMMessage[] = [...messages];

for (let iteration = 0; iteration < maxIterations; iteration++) {
      console.log(
      `🧠 LLM iteration ${iteration + 1}`
    );

    const response =
      await openrouter.chat.completions.create({
        model: "openrouter/free",
        messages: conversation,
        tools,
        tool_choice: "auto",
        max_tokens: 4000
      });

const message =
  response.choices?.[0]?.message;

if (!message) {
  throw new Error(
    `LLM returned no message. Response: ${JSON.stringify(response)}`
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

if (result.startsWith('{"error":true')) {
  console.log(`   ⚠️ Tool failed`);
} else {
  console.log(`   ✓ Tool completed`);
}

      conversation.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result
      });
    }
  }

console.log(
  "⚠️ LLM reached the tool iteration limit. Requesting final report..."
);

const finalResponse =
  await openrouter.chat.completions.create({
    model: "openrouter/free",
    messages: [
      ...conversation,
      {
        role: "user",
        content:
          "You have reached your tool-use limit. Do not call any more tools. Based only on the evidence gathered so far, provide your final response now. Be explicit about any uncertainty or unverified acceptance criteria."
      }
    ],
    tool_choice: "none",
    max_tokens: 4000
  });

return finalResponse.choices[0]?.message.content ?? "";
}