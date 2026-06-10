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
- Use JSON for agents.
- Target a known owner: `bun run coding-task-tracker --owner <path> <command> --json`.
- Check Notion access: `bun run coding-task-tracker --owner <path> doctor --json`.
- List pickable work: `bun run coding-task-tracker --owner <path> ready --json`.
- Read CLI help for exact flags, target syntax, enums, and output fields.

## Fast Task Capture

- Use when the user asks to add several tasks from known findings.
- Resolve the owner once.
- Run `bun run coding-task-tracker --owner <path> doctor --json` once before writes when access is uncertain.
- Skip ready/list scans unless the user asks or a likely duplicate is already known.
- Create all obvious tasks before enrichment.
- Use `bun run coding-task-tracker --owner <path> create --name <text> --priority <P0|P1|P2|P3> --category <bug|enhancement> --repo <repo> --reference-url <url> --json`.
- Add notes only when title, priority, category, and reference URL cannot carry the needed context.
- Do not fetch every created task after a confirmed create.
- Do not run read-back loops after every note.
- Return confirmed creates from `data.created`, plus skipped duplicates.
- Do not invent task IDs; report `task_id`, `page_url`, or `page_id` only when the create output includes them.
- Enrich created tasks by `--page-id <page_id>` from create output; `--task-id` accepts only the short numeric id (`29` / `TASK-29`), not the page UUID.

## Safety

- Resolve the nearest owner binding before Notion reads or writes.
- Allow inherited owner reads.
- Block inherited owner writes before Notion access.
- Use `--owner <path>` or the owner cwd for writes.
- Bind a child path when the child needs its own tracker.
- Mutate only the resolved owner binding's configured Coding Task Tracker data source.
- Use `bind` as the setup path when owner config is missing.
- Do not let CRUD commands create or change tracker binding config.
- Fetch targets before writes.
- Fail closed on zero or multiple task matches.
- Use `--force` only for an explicit user override.
- Do not move, delete, or archive tasks through this skill.

## Workflow

- Discover the owner with `bun run coding-task-tracker --json`.
- Check access with `bun run coding-task-tracker --owner <path> doctor --json`.
- List pickable work with `bun run coding-task-tracker --owner <path> ready --json`.
- Fetch task detail with `bun run coding-task-tracker --owner <path> get --task-id <id> --json`.
- Create backlog tasks with `bun run coding-task-tracker --owner <path> create --name <text> --json`.
- Claim pickable tasks with `bun run coding-task-tracker --owner <path> claim --task-id <id> --agent <name> --branch <branch> --json`; `--branch` is the branch the work will land on, not the current branch — propose a new one (or ask once) when none exists yet.
- Record progress with `bun run coding-task-tracker --owner <path> note --task-id <id> --message <text> --json`.
- Use owner-qualified `block`, `review`, `done`, `priority`, or `triage` commands for state changes.
- Read the JSON `next_action` before continuing.

## Report Shape

- Summarize tracker owner, read status, and counts first.
- Group tasks by useful action, such as ready, needs triage, blocked, or inspect.
- Include task ID, priority, name, and current `next_safe_action`.
- End read or triage summaries with `Suggested options:`.
- Format `Suggested options:` as a numbered action router only.
- Each numbered item must be a selectable next action.
- Do not use numbered lists or bullets for generic content inventories.
- Do not write `It includes:` followed by a list.
- Put the best next action first.
- Include `Needs triage` as a read option every time.
- Include triage as a suggested option every time.
- Include every relevant safe action for the current state.
- Use short option labels, not code blocks.
- Omit commands by default; show exact commands only when the user asks.
- Mark write options clearly; do not mutate until the user chooses one.
- Keep extra task lists short; offer a command to inspect more.

## Suggested Options

- Ready tasks: claim, Needs triage, inspect detail, show exact commands.
- Untriaged tasks: Needs triage, triage one task, inspect detail, create task, show exact commands.
- Blocked tasks: inspect detail, add note, move to review, mark done, Needs triage, triage, show exact commands.
- Active task: add note, block, move to review, mark done, change priority, Needs triage, triage, show exact commands.
- Empty ready list: Needs triage, create task, check tracker access, show exact commands.
- Missing owner: choose owner, bind owner, check configured owner, show exact commands.
- Mark write options with `Write:` before the label.
- Do not mark `Needs triage` with `Write:`; it reads the needs-triage queue.
- Use numbered router labels only when asking the user to choose.
- Keep summaries as short prose or compact grouped task rows, not general bullet lists.

## Gotchas

- `tracker_not_configured`: choose the intended owner path before binding.
- Inherited reads are advisory; writes need `--owner <path>` or the owner cwd.
- From `skills/coding-task-tracker`, pass `--owner <path>` for owner-specific reads.
- `bind` writes owner config; run it only for the path that should own the tracker.
- Slow task capture: avoid create-note-readback loops; capture tasks first, enrich only when needed.
- `No matching ... task found` after create: target writes with `--page-id <uuid>`; `--task-id` is short-numeric only. See `bun run coding-task-tracker note --help`.
- `claim --branch` has no default; don't reuse an unrelated current branch. Name the work branch, or propose/ask once when none exists.

## Verification

- YAML-parse this file after edits.
- Run `cd skills/coding-task-tracker && bun test`.
- Run `cd skills/coding-task-tracker && bun run typecheck`.
- Smoke read with an intended owner: `cd skills/coding-task-tracker && bun run coding-task-tracker --owner <path> ready --json`.

## Next Safe Action

- Run `bun run coding-task-tracker --json` when the tracker owner domain is unclear.
- Run `bun run coding-task-tracker --owner <path> doctor --json` when Notion access is uncertain.
- Run `bun run coding-task-tracker bind --owner <path> --owner-key <key> --data-source <url> --ready-view <url> --all-tasks-view <url> --json` when owner config is missing.
- Run `bun run coding-task-tracker --owner <path> ready --json` to find pickable work.
- Run `bun run coding-task-tracker --owner <path> get --task-id <id> --json` before mutating a task.
- Read `next_action` from the helper output before continuing.
