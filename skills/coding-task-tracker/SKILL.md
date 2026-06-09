---
name: coding-task-tracker
description: "Use Notion Coding Task Tracker task CRUD: ready queue, lookup, create, claim, progress notes, block, review, done, priority, and triage."
role: tool-workflow
---

# Coding Task Tracker

Use this for Notion-backed Coding Task Tracker work.

## Owner

- Tracker source: nearest owner-scoped Notion `Coding Task Tracker`.
- Runtime owner: `skills/coding-task-tracker/src/coding-task-tracker.ts`.
- Contract owner: CLI help, parser, output envelope, and tests in `skills/coding-task-tracker/src/`.
- Notion transport owner: `mcporter` server selector `notion`.
- Owner binding config: nearest `.coding-task-tracker/` directory upward from the command working directory.
- Committed owner identity: `.coding-task-tracker/repo.json`.
- Ignored local Notion binding: `.coding-task-tracker/local.json`.

## Commands

- Run from skill root: `cd skills/coding-task-tracker`.
- Choose owner domain: `bun run coding-task-tracker --json`.
- Inspect help: `bun run coding-task-tracker --help`.
- Use JSON for agents: `bun run coding-task-tracker ready --json`.
- Check Notion access: `bun run coding-task-tracker doctor --json`.
- Target a known owner: `bun run coding-task-tracker --owner <path> ready --json`.
- Bind an existing tracker: `bun run coding-task-tracker bind --owner . --data-source <collection-url> --ready-view <view-url> --all-tasks-view <view-url> --json`.
- Target existing tasks with `--task-id <TASK-N>`, `--page-id <uuid>`, or `--url <notion-page-url>`.
- Use category values `bug` or `enhancement`.

## Safety

- Resolve the nearest owner binding before Notion reads or writes.
- Allow inherited owner reads.
- Block inherited owner writes before Notion access.
- Pass `--owner <path>` or run from the owner path for writes.
- Bind a child path when the child needs its own tracker.
- Mutate only the resolved owner binding's configured Coding Task Tracker data source.
- Use `bind` as the setup path when owner config is missing.
- Do not let CRUD commands create or change tracker binding config.
- Treat pickable tasks as `Status = Ready` plus `Triage State = ready-for-agent`.
- Fetch targets before writes.
- Stop on zero or multiple task matches.
- Use `--force` only when the user explicitly overrides the pickable-task gate.
- Do not move, delete, or archive tasks through this skill.

## Workflow

- List pickable work with `ready --json`.
- Fetch task detail with `get --task-id <id> --json`.
- After `create --name <text> --json`, use the returned Notion page URL or list/get read-back to find the generated `TASK-*` ID.
- If a command returns `tracker_not_configured`, run `bind` from the intended owner path.
- If a read reports an inherited owner, confirm the owner before writing.
- If a write reports inherited owner blocking, rerun with `--owner <path>` or bind the current path.
- Claim only pickable tasks with `claim --task-id <id> --agent <name> --branch <branch> --json`.
- Record progress with `note --task-id <id> --message <text> --json`.
- Use `block`, `review`, `done`, `priority`, or `triage` for state changes.
- Make backlog work pickable with `triage --task-id <id> --status Ready --triage-state ready-for-agent --json`.
- Read the JSON `next_action` before continuing.

## Verification

- YAML-parse this file after edits.
- Run `cd skills/coding-task-tracker && bun test`.
- Run `cd skills/coding-task-tracker && bun run typecheck`.
- Smoke read: `cd skills/coding-task-tracker && bun run coding-task-tracker ready --json`.

## Next Safe Action

- Run `bun run coding-task-tracker --json` when the tracker owner domain is unclear.
- Run `doctor --json` when Notion access is uncertain.
- Run `bind --json` when owner config is missing.
- Run `ready --json` to find pickable work.
- Run `get --task-id <id> --json` before mutating a task.
- Read `next_action` from the helper output before continuing.
