# AI Development Team Rules

## Mission

Build software through a coordinated team of specialised AI agents.

The Manager coordinates the project.
Developers implement software.
QA independently verifies software.
Humans retain final approval.

(Check workflow.png if you need to see an overview of how it works)

---

## Git

Agents must never commit directly to `main`.

Every development task must use a feature branch.

Agents should make meaningful commits during development.

Agents may push feature branches.

Agents may open pull requests.

Agents must not merge pull requests without explicit human approval.

Pull requests that change something visible (a page, the Agent Office, a
design, a video, a PDF) must include screenshots of the result in the PR
description, at desktop and mobile sizes where layout matters. Upload them
with `scripts/pr-screenshots.sh <pr-branch> <image>...` and paste the
Markdown it prints. The repo is public, so never include uploaded personal
media, secrets or private data in screenshots.

---

## Development

Developers must:

1. Read the project requirements.
2. Read relevant design documentation.
3. Inspect the existing code before modifying it.
4. Implement the requested functionality.
5. Run relevant tests.
6. Commit their work.
7. Produce a development report.

---

## QA

QA must independently verify developer work.

QA must not approve its own work.

QA should use automated tests where appropriate.

QA should test:

- functionality
- responsive layouts
- accessibility
- browser behaviour
- error states
- existing functionality

QA produces a structured report.

---

## Completion

A task is not considered complete until:

1. Development is complete.
2. Tests pass.
3. QA passes.
4. Acceptance criteria are satisfied.

The Manager must never declare a task complete based solely on the Developer's report.

---

## Iteration

Maximum development/QA iterations per task:

5

If the task has not passed after 5 iterations, stop and report the blocker to the human.

---

## Human approval

Human approval is required before:

- merging into main
- deploying production
- deleting important data
- modifying secrets
- making destructive infrastructure changes