---
name: pick-an-issue
description: "Helps agents find, inspect, choose, claim, and start work from a ready issue in the project issue tracker. Use when the user asks to pick up an issue, find the next issue to work on, start a ready-for-agent ticket, choose work from the backlog, or begin work from a GitHub issue."
role: tool-workflow
---

# Pick An Issue

Pick up ready issue-tracker work safely. Keep issue selection, triage, planning, runbook orchestration, and implementation as separate concerns.

## Quick start

1. Read repo issue, label, and git workflow docs when present.
2. List open issues in the ready-agent queue.
3. Inspect up to 6 likely candidates by reading full bodies and comments.
4. Present the best 3 candidates and wait for the user to choose.
5. Ask before claiming, branching, planning, or implementing.

## Protocol

### Load conventions

Read local docs before recommending tracker or git actions:

- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`
- `docs/git/conventions.md`
- `docs/git/workflows.md`
- repo `AGENTS.md` / `CLAUDE.md`

If issue-tracker docs are missing, infer the tracker from the git remote when possible and ask before tracker mutation.

### Find ready work

Start with the repo's ready-agent queue. For GitHub trackers where local docs map the ready role to `ready-for-agent`:

```bash
gh issue list --state open --label ready-for-agent
```

Do not treat these as implementation candidates:

- `needs-triage`: hand off to `triage`
- `needs-info`: blocked until requested information exists
- `ready-for-human`: requires human implementation
- `wontfix`: not actionable

If no suitable ready-agent issues exist, say so clearly and recommend `triage` for `needs-triage` work.

### Inspect and shortlist

Prefilter metadata, inspect up to 6 likely candidates, then show the best 3. For GitHub, use `gh issue view <number> --comments`.

Rank by: unblocked, unassigned, clear and small scope, then older first when tied.

Each candidate summary should include issue number/title, labels, assignment status, risk, pickup rationale, blockers or unclear decisions, and likely verification checks.

Wait for the user to choose. Do not assign, comment, branch, plan, or implement until the user chooses an issue and confirms the next action.

### Claim

After the user chooses, ask how to claim it. Recommend assignment only; offer a comment as an optional visible signal.

For GitHub, use `gh issue edit <number> --add-assignee @me`. If the user wants a visible signal, use `gh issue comment <number> --body "Picking this up."`

Use the current authenticated username if required. Do not assume `@me` works everywhere.

### Branch

Check git state first with `git status --porcelain -b` and `git branch --show-current`.

Read repo git docs for branch naming rules. If none exist, offer `codex/<issue-number>-short-description`.

Offer both paths: create a new issue branch, or continue on the current branch. Recommend a new branch on protected branches such as `main` or `master`. Recommend continuing when the current branch already looks issue-specific and the working tree is safe.

### Route bigger work

Before implementation, route if needed:

- `triage`: `needs-triage` issues
- `ce-plan`: multi-step, ambiguous, cross-boundary, or architecture-affecting issues
- `runbook-orchestrator`: Claude Code only, when the issue maps to an existing runbook area or iterative `/goal` workflow
- inline checklist: small, obvious fixes

For Claude Code runbook work, suggest `/runbook-orchestrator status <area-path>` or `/runbook-orchestrator launch <area-path> <seam-name>`. Do not use runbook orchestration for ordinary one-off implementation issues.

### Small implementation path

For small, obvious fixes: read relevant files/docs, make a brief plan, confirm if non-trivial, implement in small steps, then run appropriate tests, lint, and type checks. Prefer repo-provided or MCP quality runners.

When committing, reference the issue with `Closes #<number>` and include a test plan in the PR. For full commit, push, and PR orchestration, defer to repo git docs or the relevant shipping skill.
