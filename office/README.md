# Agent Office

A local web app where you give the AI team requests and watch them work. The Manager, Senior Dev, Jr Dev and QA are pixel characters who carry the real task files, dev reports and QA reports between desks while the orchestrator runs.

## Run it

```sh
npm run office        # real team, using your Claude Code login
npm run office:demo   # stand-in agents, no Claude usage
```

Then open http://localhost:4321 (set `OFFICE_PORT` to change the port).

Demo mode keeps its projects in `.office-demo/projects` (git-ignored), so it never touches your real projects.

## What you can do

- **Projects:** create one (this makes `projects/<name>` with `PRD.md`, `AGENTS.md` and `.ai/`) or delete one (you have to type its name to confirm).
- **Requests:** describe what you want. The Manager reads the project and writes `.ai/tasks/TASK-xxx.json` with acceptance criteria, then assigns the task: large tasks go to the Senior Dev, small ones to the Jr Dev. You can also pick the developer yourself.
- **Approval:** when QA passes a task, it shows up under "Needs you". Approve it, or send it back with notes, which are added to the task file as `humanFeedback`. A task that fails QA 5 times is blocked and also comes back to you.
- **Files:** every handoff in the log links to the file that was passed: `TASK-xxx.json`, `dev-report.md` or `qa-report.json`. The reports for each round are kept in `.ai/reports/<task>/`.

## The team

`team.json` sets each member's name and Claude model (`opus`, `sonnet`, or a full model ID), plus the maximum number of dev/QA rounds.

## Git

In live mode, each task runs on its own branch, `task/<project>-<TASK>`, created from the current branch when there are no uncommitted changes to tracked files. When the run ends, the project folder is committed to that branch. Nothing is ever committed to `main` or `master`, and nothing is merged or pushed: approving a task tells you which branch to merge. Set `OFFICE_GIT=off` to turn this off.

Tasks run one at a time, across all projects, because they share one git working tree.

## Safety

The server only listens on `127.0.0.1`. It only accepts requests addressed to `localhost`, and only accepts changes from its own page. That matters because it can run agents that execute commands and can delete project folders.
