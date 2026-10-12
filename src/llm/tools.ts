import {
  readProjectFile,
  listProjectFiles,
  writeProjectFile
} from "../tools/filesystem.js";

import { runCommand } from "../tools/terminal.js";

export const llmTools = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description:
        "Read a text file from the current project.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description:
              "Path to the file relative to the project root."
          }
        },
        required: ["filePath"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description:
        "List files and folders in the current project directory.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
description:
  "Write the complete contents of a text file. Do not use edit_file or patch operations. When modifying an existing file, first read it, then use this tool with the complete replacement content.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description:
              "Path to the file relative to the project root."
          },
          content: {
            type: "string",
description:
  "The COMPLETE replacement contents of the file. Never provide a partial edit, patch, or diff.",
          }
        },
        required: ["filePath", "content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "run_command",
      description:
        "Run a terminal command from the current project directory.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "The terminal command to execute."
          }
        },
        required: ["command"],
        additionalProperties: false
      }
    }
  }
];

export const qaTools = llmTools.filter(
  (tool) =>
    tool.function.name === "read_file" ||
    tool.function.name === "run_command"
);

export async function executeTool(
  name: string,
  argumentsJson: string,
  projectPath: string
): Promise<string> {
  try {
    const args = JSON.parse(argumentsJson);

    if (name === "read_file") {
      return await readProjectFile(
        projectPath,
        args.filePath
      );
    }

    if (name === "list_files") {
      const files =
        await listProjectFiles(projectPath);

      return JSON.stringify(files, null, 2);
    }

    if (name === "write_file") {
      await writeProjectFile(
        projectPath,
        args.filePath,
        args.content
      );

      return `Successfully wrote ${args.filePath}`;
    }

    if (name === "run_command") {
      const result = await runCommand(
        args.command,
        projectPath
      );

      return JSON.stringify({
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      });
    }

return JSON.stringify({
  error: true,
  tool: name,
  message: `Unknown tool: ${name}`,
  availableTools: [
    "read_file",
    "list_files",
    "write_file",
    "run_command"
  ],
  instruction:
    "Use only the available tools. To modify a file, use write_file with the complete file contents."
});  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `⚠️ Tool execution failed: ${message}`
    );

    return JSON.stringify({
      error: true,
      tool: name,
      message,
      instruction:
        "The tool call failed. Correct the arguments and try again."
    });
  }
}