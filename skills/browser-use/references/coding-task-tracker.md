# Coding Task Tracker

Use this when browser-use work needs task state.

## Owner

- Tracker skill: `skills/coding-task-tracker/SKILL.md`.
- Tracker helper: `skills/coding-task-tracker/src/coding-task-tracker.ts`.
- Browser-use front door: `skills/browser-use/SKILL.md`.
- Browser-use plans: `docs/plans/`.
- Browser-use decisions: `docs/decisions/`.

## Rules

- Use the `coding-task-tracker` skill for task CRUD.
- Do not call raw Notion for normal tracker work.
- Treat Notion as task source of truth.
- Keep repo docs as evidence, not duplicated task state.
- Use `--owner ../browser-use` from `skills/coding-task-tracker`.
- Treat `skills/browser-use/.coding-task-tracker/repo.json` as the browser-use owner identity.
- Keep `skills/browser-use/.coding-task-tracker/local.json` ignored.
- Pickable tasks have `Status = Ready` and `Triage State = ready-for-agent`.
- Claim before starting implementation work.
- Add progress notes when a browser-use investigation finds durable evidence.
- Mark blocked with a reason when git history, plans, auth, or tool state prevents safe continuation.

## Commands

- Run from `skills/coding-task-tracker`.
- Check access: `bun run coding-task-tracker --owner ../browser-use doctor --json`.
- List pickable work: `bun run coding-task-tracker --owner ../browser-use ready --json`.
- Fetch a task: `bun run coding-task-tracker --owner ../browser-use get --task-id <id> --json`.
- Claim a task: `bun run coding-task-tracker --owner ../browser-use claim --task-id <id> --agent codex --branch <branch> --json`.
- Add evidence: `bun run coding-task-tracker --owner ../browser-use note --task-id <id> --message <text> --json`.
- Block: `bun run coding-task-tracker --owner ../browser-use block --task-id <id> --reason <text> --json`.
- Move to review: `bun run coding-task-tracker --owner ../browser-use review --task-id <id> --pull-request <url> --json`.
- Mark done: `bun run coding-task-tracker --owner ../browser-use done --task-id <id> --json`.

## Browser-Use Intake

- Start by reading the task.
- Read `next_action` from the helper output.
- Search browser-use git history for touched files, commits, branches, and reverted work.
- Search `docs/plans/`, `docs/decisions/`, `docs/brainstorms/`, and browser-use references for accepted scope.
- Summarize what is done, what is partial, what is stale, and what is next.
- Save the summary as a tracker note before changing code.

## Next Safe Action

- Run `doctor --json` with the intended owner.
- Run `ready --json` with the intended owner.
- If no browser-use task is pickable, create or triage one before implementation.
