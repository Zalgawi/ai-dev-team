import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

export type MemberId = "manager" | "senior" | "junior" | "qa";

export interface TeamMember {
  name: string;
  // Claude model name or alias passed to the Agent SDK ("opus", "sonnet", ...).
  model?: string;
}

export interface TeamConfig {
  maxIterations: number;
  members: Record<MemberId, TeamMember>;
}

// Task files name their developer with assignedTo. "developer" is what older
// task files use, and goes to the Senior Dev.
export const ASSIGNEE_TO_MEMBER: Record<string, MemberId> = {
  "senior-developer": "senior",
  "junior-developer": "junior",
  developer: "senior"
};

export const DEFAULT_TEAM: TeamConfig = {
  maxIterations: 5,
  members: {
    manager: { name: "Manager", model: "sonnet" },
    senior: { name: "Senior Dev", model: "opus" },
    junior: { name: "Jr Dev", model: "sonnet" },
    qa: { name: "QA", model: "sonnet" }
  }
};

export async function loadTeam(
  file = path.join(REPO_ROOT, "team.json")
): Promise<TeamConfig> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as Partial<TeamConfig>;

    return {
      maxIterations: parsed.maxIterations ?? DEFAULT_TEAM.maxIterations,
      members: {
        manager: { ...DEFAULT_TEAM.members.manager, ...parsed.members?.manager },
        senior: { ...DEFAULT_TEAM.members.senior, ...parsed.members?.senior },
        junior: { ...DEFAULT_TEAM.members.junior, ...parsed.members?.junior },
        qa: { ...DEFAULT_TEAM.members.qa, ...parsed.members?.qa }
      }
    };
  } catch {
    return DEFAULT_TEAM;
  }
}
