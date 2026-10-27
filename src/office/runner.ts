import { EventEmitter } from "node:events";

import type { Agent } from "../agents/types.js";
import { DeveloperAgent } from "../agents/developer/developer.js";
import { QAAgent } from "../agents/qa/qa.js";
import { ManagerAgent } from "../manager/manager.js";
import { planTask, type TaskPlan, type TaskSize } from "../manager/planner.js";
import type { TeamEvent } from "../orchestration/events.js";
import { Orchestrator } from "../orchestration/orchestrator.js";
import { ASSIGNEE_TO_MEMBER, type MemberId, type TeamConfig } from "../team.js";
import {
  checkoutBranch,
  commitPath,
  currentBranch,
  hasCleanTrackedFiles,
  isGitRepo,
  isProtectedBranch
} from "../tools/git.js";
import { DemoDeveloper, DemoQA, demoPlan, type DemoOptions } from "./demo.js";
import { ProjectError, type ProjectStore, type TaskFile } from "./projects.js";

export interface Job {
  id: number;
  kind: "request" | "run";
  project: string;
  taskId?: string;
  request?: string;
  size?: TaskSize;
}

type OfficeOnlyEvent =
  | { type: "job-queued"; kind: Job["kind"]; request?: string }
  | { type: "job-start"; kind: Job["kind"] }
  | { type: "task-created"; task: TaskFile; member: MemberId }
  | { type: "task-updated"; task: TaskFile }
  | { type: "git"; message: string }
  | { type: "job-error"; error: string }
  | { type: "job-end"; status: string }
  | { type: "projects-changed" };

export type OfficeEvent = (TeamEvent | OfficeOnlyEvent) & {
  seq: number;
  time: string;
  project?: string;
  taskId?: string;
  jobId?: number;
};

export interface RunnerOptions {
  // Use stand-in agents instead of Claude.
  demo?: DemoOptions | false;
  // Create a task branch per task and commit the project folder at the end.
  git?: boolean;
}

export interface Snapshot {
  current: Job | null;
  queue: Job[];
  activeAgent: string | null;
  activity: string | null;
  iteration: number;
}

const memberFor = (agent: string): string =>
  ASSIGNEE_TO_MEMBER[agent] ?? agent;

// Runs one job at a time: projects share a git working tree, so two tasks
// must never change files or branches at once.
export class TeamRunner extends EventEmitter {
  private queue: Job[] = [];
  private current: Job | null = null;
  private nextJobId = 1;
  private seq = 0;
  private activeAgent: string | null = null;
  private activity: string | null = null;
  private iteration = 0;

  constructor(
    private store: ProjectStore,
    private team: TeamConfig,
    private options: RunnerOptions = {}
  ) {
    super();
  }

  get demo(): boolean {
    return Boolean(this.options.demo);
  }

  snapshot(): Snapshot {
    return {
      current: this.current,
      queue: [...this.queue],
      activeAgent: this.activeAgent,
      activity: this.activity,
      iteration: this.iteration
    };
  }

  isBusy(project: string): boolean {
    return (
      this.current?.project === project ||
      this.queue.some((job) => job.project === project)
    );
  }

  publish(
    event: TeamEvent | OfficeOnlyEvent,
    job?: Job
  ): void {
    const full = {
      ...event,
      seq: ++this.seq,
      time: new Date().toISOString(),
      ...(job ? { project: job.project, jobId: job.id } : {}),
      ...(job?.taskId ? { taskId: job.taskId } : {})
    } as OfficeEvent;

    if ("agent" in full) full.agent = memberFor(full.agent);

    if (full.type === "agent-start") {
      this.activeAgent = full.agent;
      this.activity = null;
      this.iteration = full.iteration;
    } else if (full.type === "agent-activity") {
      this.activity = full.activity;
    }

    this.emit("event", full);
  }

  async enqueueRequest(
    project: string,
    request: string,
    size: TaskSize = "auto"
  ): Promise<Job> {
    await this.store.get(project);

    if (!request.trim()) {
      throw new ProjectError("Describe what the team should build.");
    }

    return this.enqueue({ id: this.nextJobId++, kind: "request", project, request: request.trim(), size });
  }

  async enqueueRun(project: string, taskId: string): Promise<Job> {
    const task = await this.store.readTask(project, taskId);

    if (!task) throw new ProjectError(`${taskId} does not exist in ${project}.`, 404);

    if (this.current?.taskId === taskId && this.current.project === project) {
      throw new ProjectError(`${taskId} is already running.`, 409);
    }

    return this.enqueue({ id: this.nextJobId++, kind: "run", project, taskId });
  }

  async approve(project: string, taskId: string): Promise<TaskFile> {
    const task = await this.store.updateTask(project, taskId, { status: "approved" });
    const job: Job = { id: 0, kind: "run", project, taskId };

    this.publish({ type: "task-updated", task }, job);
    if (this.options.git && !this.demo) {
      this.publish({ type: "git", message: `Approved. Merge task/${project}-${taskId} into main when you're ready.` }, job);
    }

    return task;
  }

  async requestChanges(
    project: string,
    taskId: string,
    notes: string
  ): Promise<Job> {
    const task = await this.store.readTask(project, taskId);
    if (!task) throw new ProjectError(`${taskId} does not exist in ${project}.`, 404);

    const updated = await this.store.updateTask(project, taskId, {
      status: "changes_requested",
      humanFeedback: [
        ...(task.humanFeedback ?? []),
        { time: new Date().toISOString(), notes: notes.trim() || "Please revise." }
      ]
    });

    this.publish({ type: "task-updated", task: updated }, { id: 0, kind: "run", project, taskId });

    return this.enqueueRun(project, taskId);
  }

  private enqueue(job: Job): Job {
    this.queue.push(job);
    this.publish(
      { type: "job-queued", kind: job.kind, ...(job.request ? { request: job.request } : {}) },
      job
    );
    void this.pump();
    return job;
  }

  private async pump(): Promise<void> {
    if (this.current) return;

    const job = this.queue.shift();
    if (!job) return;

    this.current = job;

    try {
      await this.runJob(job);
    } finally {
      this.current = null;
      this.activeAgent = null;
      this.activity = null;
      this.iteration = 0;
      void this.pump();
    }
  }

  private buildTeam() {
    const { members } = this.team;
    const demo = this.options.demo;

    const senior: Agent = demo
      ? new DemoDeveloper(members.senior.name, demo)
      : new DeveloperAgent(members.senior.name, members.senior.model);
    const junior: Agent = demo
      ? new DemoDeveloper(members.junior.name, demo)
      : new DeveloperAgent(members.junior.name, members.junior.model);
    const qa: Agent = demo ? new DemoQA(demo) : new QAAgent(members.qa.model);

    return { senior, junior, qa };
  }

  private async plan(job: Job, projectPath: string, taskId: string): Promise<TaskPlan> {
    const onActivity = (activity: string) =>
      this.publish({ type: "agent-activity", agent: "manager", activity }, job);

    if (this.options.demo) {
      return demoPlan(job.request ?? "", { onActivity }, this.options.demo);
    }

    return planTask(projectPath, taskId, job.request ?? "", {
      model: this.team.members.manager.model,
      onActivity
    });
  }

  private async runJob(job: Job): Promise<void> {
    let status = "failed";

    this.publish({ type: "job-start", kind: job.kind }, job);

    try {
      const projectPath = this.store.projectPath(job.project);

      if (job.kind === "request") {
        job.taskId = await this.store.nextTaskId(job.project);
      }

      const taskId = job.taskId!;
      await this.prepareBranch(job, projectPath, taskId);

      let task: TaskFile;

      if (job.kind === "request") {
        this.publish({ type: "agent-start", agent: "manager", iteration: 0 }, job);

        const plan = await this.plan(job, projectPath, taskId);
        const size = job.size && job.size !== "auto" ? job.size : plan.size;

        task = {
          id: taskId,
          title: plan.title,
          description: plan.description,
          status: "in_progress",
          assignedTo: size === "large" ? "senior-developer" : "junior-developer",
          priority: plan.priority,
          request: job.request ?? "",
          acceptanceCriteria: plan.acceptanceCriteria
        };

        await this.store.writeTask(job.project, task);
        this.publish(
          { type: "task-created", task, member: ASSIGNEE_TO_MEMBER[task.assignedTo] ?? "senior" },
          job
        );
      } else {
        task = await this.store.updateTask(job.project, taskId, { status: "in_progress" });
        this.publish({ type: "task-updated", task }, job);
      }

      const { senior, junior, qa } = this.buildTeam();
      let runEnd = "failed";

      const orchestrator = new Orchestrator(new ManagerAgent(), senior, qa, {
        developers: {
          "senior-developer": senior,
          "junior-developer": junior,
          developer: senior
        },
        onEvent: (event) => {
          if (event.type === "run-end") runEnd = event.status;
          this.publish(event, job);
        }
      });

      await orchestrator.run(
        { projectPath, taskId, iteration: 1 },
        this.team.maxIterations
      );

      status = runEnd;

      const finalStatus =
        runEnd === "completed" ? "awaiting_approval" : runEnd === "blocked" ? "blocked" : "failed";

      task = await this.store.updateTask(job.project, taskId, { status: finalStatus });
      this.publish({ type: "task-updated", task }, job);

      await this.finishBranch(job, projectPath, task, runEnd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Job ${job.id} failed:`, error);
      this.publish({ type: "job-error", error: message }, job);

      if (job.taskId) {
        try {
          const task = await this.store.updateTask(job.project, job.taskId, { status: "failed" });
          this.publish({ type: "task-updated", task }, job);
        } catch {
          // The task file was never written (planning failed).
        }
      }
    } finally {
      this.publish({ type: "job-end", status }, job);
    }
  }

  private async prepareBranch(job: Job, projectPath: string, taskId: string): Promise<void> {
    if (!this.options.git || this.demo || !(await isGitRepo(projectPath))) return;

    const branch = `task/${job.project}-${taskId}`;
    const current = await currentBranch(projectPath);

    if (current === branch) {
      this.publish({ type: "git", message: `Working on ${branch}.` }, job);
      return;
    }

    if (!(await hasCleanTrackedFiles(projectPath))) {
      this.publish(
        { type: "git", message: `There are uncommitted changes, so the team is working on ${current} instead of a new task branch.` },
        job
      );
      return;
    }

    const result = await checkoutBranch(projectPath, branch);
    this.publish(
      { type: "git", message: result.ok ? `Switched to ${branch}.` : `Could not switch to ${branch}: ${result.stderr}` },
      job
    );
  }

  private async finishBranch(
    job: Job,
    projectPath: string,
    task: TaskFile,
    runEnd: string
  ): Promise<void> {
    if (!this.options.git || this.demo || !(await isGitRepo(projectPath))) return;

    const branch = await currentBranch(projectPath);

    if (isProtectedBranch(branch)) {
      this.publish({ type: "git", message: `On ${branch}, so nothing was committed. Agents never commit to ${branch}.` }, job);
      return;
    }

    const message =
      runEnd === "completed"
        ? `feat(${job.project}): complete ${task.id} ${task.title}`
        : `wip(${job.project}): ${task.id} ${runEnd} after ${this.iteration || this.team.maxIterations} rounds`;

    try {
      const committed = await commitPath(projectPath, ".", message);
      this.publish(
        { type: "git", message: committed ? `Committed to ${branch}: ${message}` : "Nothing new to commit." },
        job
      );
    } catch (error) {
      this.publish({ type: "git", message: `Commit failed: ${error instanceof Error ? error.message : String(error)}` }, job);
    }
  }
}
