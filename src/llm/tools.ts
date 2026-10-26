import {
  createSdkMcpServer,
  tool
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import {
  readProjectFile,
  listProjectFiles,
  writeProjectFile
} from "../tools/filesystem.js";

import { runCommand } from "../tools/terminal.js";

// Name of the in-process MCP server that exposes the project tools.
// Claude sees each tool as `mcp__<server>__<tool>`.
export const TOOL_SERVER_NAME = "project";

export type ToolName =
  | "read_file"
  | "list_files"
  | "write_file"
  | "run_command";

export const llmTools: ToolName[] = [
  "read_file",
  "list_files",
  "write_file",
  "run_command"
];

export const qaTools: ToolName[] = [
  "read_file",
  "list_files",
  "run_command"
];

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    isError
  };
}

async function safely(
  name: ToolName,
  fn: () => Promise<string>
) {
  try {
    const result = await fn();

    console.log(`   ✓ Tool completed`);

    return textResult(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `   ⚠️ Tool execution failed: ${message}`
    );

    return textResult(
      JSON.stringify({
        error: true,
        tool: name,
        message,
        instruction:
          "The tool call failed. Correct the arguments and try again."
      }),
      true
    );
  }
}

function buildToolDefinitions(projectPath: string) {
  return {
    read_file: tool(
      "read_file",
      "Read a text file from the current project.",
      {
        filePath: z
          .string()
          .describe(
            "Path to the file relative to the project root."
          )
      },
      async (args) =>
        safely("read_file", () =>
          readProjectFile(projectPath, args.filePath)
        )
    ),

    list_files: tool(
      "list_files",
      "List files and folders in the current project directory.",
      {},
      async () =>
        safely("list_files", async () =>
          JSON.stringify(
            await listProjectFiles(projectPath),
            null,
            2
          )
        )
    ),

    write_file: tool(
      "write_file",
      "Write the complete contents of a text file. Do not use edit_file or patch operations. When modifying an existing file, first read it, then use this tool with the complete replacement content.",
      {
        filePath: z
          .string()
          .describe(
            "Path to the file relative to the project root."
          ),
        content: z
          .string()
          .describe(
            "The COMPLETE replacement contents of the file. Never provide a partial edit, patch, or diff."
          )
      },
      async (args) =>
        safely("write_file", async () => {
          await writeProjectFile(
            projectPath,
            args.filePath,
            args.content
          );

          return `Successfully wrote ${args.filePath}`;
        })
    ),

    run_command: tool(
      "run_command",
      "Run a terminal command from the current project directory.",
      {
        command: z
          .string()
          .describe("The terminal command to execute.")
      },
      async (args) =>
        safely("run_command", async () => {
          const result = await runCommand(
            args.command,
            projectPath
          );

          return JSON.stringify({
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr
          });
        })
    )
  };
}

// Builds an MCP server exposing only the requested tools, bound to one project.
export function createToolServer(
  projectPath: string,
  tools: ToolName[]
) {
  const definitions = buildToolDefinitions(projectPath);

  return createSdkMcpServer({
    name: TOOL_SERVER_NAME,
    version: "1.0.0",
    tools: tools.map((name) => definitions[name])
  });
}

export function qualifiedToolName(name: ToolName): string {
  return `mcp__${TOOL_SERVER_NAME}__${name}`;
}
