import { runAgent } from "./client.js";

const response = await runAgent(
  "./projects/trail-100",
  {
    system:
      "You are a software developer working on a project. You have access to tools that allow you to inspect and modify the project and run terminal commands.",
    prompt:
      "Run the command npm --version and tell me which npm version is installed."
  }
);

console.log("\n🤖 Final response:");
console.log(response);
