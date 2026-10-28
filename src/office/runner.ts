import { EventEmitter } from "node:events";

import type { Agent } from "../agents/types.js";
import { DesignerAgent } from "../agents/designer/designer.js";
import { DeveloperAgent } from "../agents/developer/developer.js";
import { VideoEditorAgent } from "../agents/video/video-editor.js";
import { QuantAdvisorAgent } from "../agents/quant/quant-advisor.js";
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
import { describeMedia, type MediaItem } from "./media.js";
import { ProjectError, type ProjectStore, type TaskFile } from "./projects.js";

export interface Job {
  id: number;
  kind: "request" | "run";
  project: string;
  taskId?: string;
  request?: string;
  size?: TaskSize;
  media?: MediaItem[];
}

type OfficeOnlyEvent =
  | { type: "job-queued"; kind: Job["kind"]; request?: string }
  | { type: "job-start"; kind: Job["kind"] }
  | { type: "task-created"; task: TaskFile; member: MemberId }
  | { type: "task-updated"; task: TaskFile }
  | { type: "git"; message: string }
  | { type: "job-error"; error: string }
  | { type: "job-end"; status: string }
  | { type: "stop-requested" }
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
  // Aborts the current job when the human presses the stop button.
  private abort: AbortController | null = null;

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
    size: TaskSize = "auto",
    media: MediaItem[] = []
  ): Promise<Job> {
    await this.store.get(project);

    if (!request.trim()) {
      throw new ProjectError("Describe what the team should build.");
    }

    return this.enqueue({
      id: this.nextJobId++,
      kind: "request",
      project,
      request: request.trim(),
      size,
      ...(media.length ? { media } : {})
    });
  }

  async enqueueRun(project: string, taskId: string): Promise<Job> {
    const task = await this.store.readTask(project, taskId);

    if (!task) throw new ProjectError(`${taskId} does not exist in ${project}.`, 404);

    if (this.current?.taskId === taskId && this.current.project === project) {
      throw new ProjectError(`${taskId} is already running.`, 409);
    }

    return this.enqueue({ id: this.nextJobId++, kind: "run", project, taskId });
  }

  // Ends the current job: the running agent's Claude session and any command
  // it started are aborted, the task is marked "stopped", and the work so far
  // is committed to the task branch. Queued jobs still run afterwards.
  stop(): Job {
    const job = this.current;

    if (!job || !this.abort) {
      throw new ProjectError("The team isn't working on anything right now.", 409);
    }
    if (this.abort.signal.aborted) return job;

    this.abort.abort();
    this.publish({ type: "stop-requested" }, job);

    return job;
  }

  async approve(project: string, taskId: string): Promise<TaskFile> {
    const task = await this.store.updateTask(project, taskId, { status: "approved" });
    const job: Job = { id: 0, kind: "run", project, taskId };

    this.publish({ type: "task-updated", task }, job);
    if (this.options.git && !this.demo) {
      await this.commitApproval(job, taskId);
      this.publish({ type: "git", message: `Approved. Merge task/${project}-${taskId} into main when you're ready.` }, job);
    }

    return task;
  }

  // Commits the approved task file to its own branch. Left uncommitted, it
  // would stop the next task from getting a branch of its own.
  private async commitApproval(job: Job, taskId: string): Promise<void> {
    const projectPath = this.store.projectPath(job.project);
    const branch = `task/${job.project}-${taskId}`;

    if (this.current || !(await isGitRepo(projectPath)) || (await currentBranch(projectPath)) !== branch) return;

    try {
      await commitPath(projectPath, `.ai/tasks/${taskId}.json`, `chore(${job.project}): approve ${taskId}`);
    } catch (error) {
      this.publish({ type: "git", message: `Could not commit the approval: ${error instanceof Error ? error.message : String(error)}` }, job);
    }
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
    this.abort = new AbortController();

    try {
      await this.runJob(job, this.abort.signal);
    } finally {
      this.current = null;
      this.abort = null;
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
    const designer: Agent = demo
      ? new DemoDeveloper(members.designer.name, demo)
      : new DesignerAgent(members.designer.name, members.designer.model);
    const editor: Agent = demo
      ? new DemoDeveloper(members.editor.name, demo)
      : new VideoEditorAgent(members.editor.name, members.editor.model);
    const quant: Agent = demo
      ? new DemoDeveloper(members.quant.name, demo)
      : new QuantAdvisorAgent(members.quant.name, members.quant.model);
    const qa: Agent = demo ? new DemoQA(demo) : new QAAgent(members.qa.model);

    return { senior, junior, designer, editor, quant, qa };
  }

  private async plan(job: Job, projectPath: string, taskId: string, signal: AbortSignal): Promise<TaskPlan> {
    const onActivity = (activity: string) =>
      this.publish({ type: "agent-activity", agent: "manager", activity }, job);

    // The Manager sees the attached files' descriptions with the request.
    const attached = describeMedia(job.media ?? []);
    const request = attached
      ? `${job.request ?? ""}\n\nFiles attached to this request (in the project's media/ folder; binary files can't be opened with read_file):\n${attached}`
      : job.request ?? "";

    if (this.options.demo) {
      return demoPlan(request, { onActivity, signal }, this.options.demo);
    }

    return planTask(projectPath, taskId, request, {
      model: this.team.members.manager.model,
      onActivity,
      signal
    });
  }

  private async runJob(job: Job, signal: AbortSignal): Promise<void> {
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

        const plan = await this.plan(job, projectPath, taskId, signal);
        const choice =
          job.size && job.size !== "auto"
            ? job.size
            : plan.role === "designer" ? "design"
            : plan.role === "video-editor" ? "video"
            : plan.role === "quant-advisor" ? "quant"
            : plan.size;

        task = {
          id: taskId,
          title: plan.title,
          description: plan.description,
          status: "in_progress",
          assignedTo:
            choice === "design" ? "designer"
            : choice === "video" ? "video-editor"
            : choice === "quant" ? "quant-advisor"
            : choice === "large" ? "senior-developer"
            : "junior-developer",
          priority: plan.priority,
          request: job.request ?? "",
          ...(job.media?.length
            ? { media: job.media.map((m) => ({ file: `media/${m.id}`, kind: m.kind, ...(m.note ? { note: m.note } : {}) })) }
            : {}),
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

      const { senior, junior, designer, editor, quant, qa } = this.buildTeam();
      let runEnd = "failed";

      const orchestrator = new Orchestrator(new ManagerAgent(), senior, qa, {
        developers: {
          "senior-developer": senior,
          "junior-developer": junior,
          designer,
          "video-editor": editor,
          "quant-advisor": quant,
          developer: senior
        },
        onEvent: (event) => {
          if (event.type === "run-end") runEnd = event.status;
          this.publish(event, job);
        }
      });

      await orchestrator.run(
        { projectPath, taskId, iteration: 1, signal },
        this.team.maxIterations
      );

      status = runEnd;

      const finalStatus =
        runEnd === "completed" ? "awaiting_approval" : runEnd === "blocked" || runEnd === "stopped" ? runEnd : "failed";

      task = await this.store.updateTask(job.project, taskId, { status: finalStatus });
      this.publish({ type: "task-updated", task }, job);

      await this.finishBranch(job, projectPath, task, runEnd);
    } catch (error) {
      // Stopped while the Manager was still planning.
      const stopped = signal.aborted;
      const message = stopped ? "Stopped by you." : error instanceof Error ? error.message : String(error);
      if (stopped) status = "stopped";
      else console.error(`❌ Job ${job.id} failed:`, error);
      this.publish({ type: "job-error", error: message }, job);

      if (job.taskId) {
        try {
          const task = await this.store.updateTask(job.project, job.taskId, { status: stopped ? "stopped" : "failed" });
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
