# Browser Use Tasks

## Roadmap

Browser entry roadmap pitches live in `runtime/browser-connect/TASKS.md`
`## Roadmap` (KTD7) — including the re-scoped #136–#146 cluster.

## Source Of Truth

- Source of truth: Notion `Browser-use Task Tracker`.
- Tracker database: https://app.notion.com/p/7128e0ab7dfe45fd80525b89ba283c6b
- Use `skills/coding-task-tracker/SKILL.md` for task CRUD.
- Use `skills/browser-use/references/coding-task-tracker.md` for browser-use tracker workflow.
- Do not paste raw Notion commands here.
- Do not duplicate task state here.

## Pickable Tasks

- Pickable tasks have `Status = Ready` and `Triage State = ready-for-agent`.
- List pickable work from `skills/coding-task-tracker`:

```bash
bun run coding-task-tracker --owner ../browser-use ready --json
```

- Current browser-use starter task: create or triage one in the browser-use tracker.

## Work Protocol

- Start from `skills/coding-task-tracker`.
- Check tracker access:

```bash
bun run coding-task-tracker --owner ../browser-use doctor --json
```

- Fetch the task:

```bash
bun run coding-task-tracker --owner ../browser-use get --task-id <id> --json
```

- Claim before implementation:

```bash
bun run coding-task-tracker --owner ../browser-use claim --task-id <id> --agent codex --branch <branch> --json
```

- Add evidence after read-only investigation:

```bash
bun run coding-task-tracker --owner ../browser-use note --task-id <id> --message "<summary>" --json
```

## First Investigation

- Inspect browser-use git history.
- Inspect `docs/plans/`.
- Inspect `docs/decisions/`.
- Inspect `docs/brainstorms/`.
- Inspect `skills/browser-use/`.
- Work out what is done, partial, stale, or next.
- Save the summary as a tracker note before code changes.

## Next Safe Action

- Run `bun run coding-task-tracker --owner ../browser-use ready --json` from `skills/coding-task-tracker`.
- Create or triage one browser-use task when none is pickable.
- Start read-only history and plan review.
