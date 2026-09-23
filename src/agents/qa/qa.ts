import type {
  Agent,
  AgentContext,
  AgentResult
} from "../types.js";

import { readProjectFile } from "../../tools/filesystem.js";

interface Peak {
  id: string;
  number: number;
  name: string;
  region: string;
  heightM: number;
}

export class QAAgent implements Agent {
  name = "QA";

  async run(context: AgentContext): Promise<AgentResult> {
    console.log(`🧪 QA is starting...`);

    if (!context.taskId) {
      return {
        agent: this.name,
        status: "failed",
        summary: "QA could not find a task ID."
      };
    }

    const task = await readProjectFile(
      context.projectPath,
      `.ai/tasks/${context.taskId}.json`
    );

    const taskData = JSON.parse(task);

    console.log(`   Checking task: ${taskData.id}`);
    console.log(`   Title: ${taskData.title}`);
    console.log(
      `   Acceptance criteria: ${taskData.acceptanceCriteria.length}`
    );

    const peaksFile = await readProjectFile(
      context.projectPath,
      "data/peaks.json"
    );

    const cleanPeaksFile = peaksFile.replace(/^\uFEFF/, "");

    let peaks: Peak[];

    try {
      peaks = JSON.parse(cleanPeaksFile);
    } catch (error) {
      console.error("❌ QA failed to parse peaks.json");
      console.error(error);

      return {
        agent: this.name,
        status: "failed",
        summary: "QA could not parse data/peaks.json.",
        issues: ["data/peaks.json contains invalid JSON."]
      };
    }

    console.log(`🔍 QA inspected Trail 100 data.`);
    console.log(`   Peak count: ${peaks.length}`);

    if (!Array.isArray(peaks)) {
      return {
        agent: this.name,
        status: "failed",
        summary: "QA found that peaks.json does not contain an array.",
        issues: ["Trail 100 dataset is not an array."]
      };
    }

    if (peaks.length !== 100) {
      return {
        agent: this.name,
        status: "failed",
        summary: `QA found ${peaks.length} peaks instead of 100.`,
        issues: [`Expected 100 peaks but found ${peaks.length}.`]
      };
    }

    console.log("   ✓ Dataset contains exactly 100 peaks.");

    const requiredFields = [
      "id",
      "number",
      "name",
      "region",
      "heightM"
    ];

    const issues: string[] = [];

    for (const peak of peaks) {
      for (const field of requiredFields) {
        if (!(field in peak)) {
          issues.push(
            `Peak ${peak.number ?? "unknown"} is missing "${field}".`
          );
        }
      }
    }

    if (issues.length > 0) {
      console.log("❌ QA found missing fields.");

      return {
        agent: this.name,
        status: "failed",
        summary: `QA found ${issues.length} data validation issue(s).`,
        issues
      };
    }

    console.log("   ✓ Every peak contains all required fields.");

    const ids = peaks.map((peak) => peak.id);
    const numbers = peaks.map((peak) => peak.number);

    const duplicateIds = ids.filter(
      (id, index) => ids.indexOf(id) !== index
    );

    const duplicateNumbers = numbers.filter(
      (number, index) => numbers.indexOf(number) !== index
    );

    if (duplicateIds.length > 0) {
      issues.push(
        `Duplicate peak IDs found: ${[
          ...new Set(duplicateIds)
        ].join(", ")}`
      );
    }

    if (duplicateNumbers.length > 0) {
      issues.push(
        `Duplicate peak numbers found: ${[
          ...new Set(duplicateNumbers)
        ].join(", ")}`
      );
    }

    if (issues.length > 0) {
      console.log("❌ QA found duplicate identifiers.");

      return {
        agent: this.name,
        status: "failed",
        summary: `QA found ${issues.length} data integrity issue(s).`,
        issues
      };
    }

    console.log("   ✓ All peak IDs are unique.");
    console.log("   ✓ All peak numbers are unique.");

    return {
      agent: this.name,
      status: "completed",
      summary:
        "QA verified all 100 peaks and confirmed the dataset structure and identifiers are valid."
    };
  }
}