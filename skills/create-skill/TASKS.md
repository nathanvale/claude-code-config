# Create Skill Tasks

## Source Of Truth

- Source of truth: Notion `Create-skill Task Tracker`.
- Tracker database: https://app.notion.com/p/685c216f056b4ad580763d05d0a34078
- Tracker owner: `skills/create-skill/.coding-task-tracker/repo.json`.
- Local binding: `skills/create-skill/.coding-task-tracker/local.json`.
- Archive source: `skills/create-skill/TASKS.md.archive`.
- Use `skills/coding-task-tracker/SKILL.md` for task CRUD.
- Do not duplicate task state here.

## Commands

- Run from `skills/coding-task-tracker`.
- Check access:

```bash
bun run coding-task-tracker --owner ../create-skill doctor --json
```

- List pickable work:

```bash
bun run coding-task-tracker --owner ../create-skill ready --json
```

- Fetch a task:

```bash
bun run coding-task-tracker --owner ../create-skill get --task-id <id> --json
```

- Claim a task:

```bash
bun run coding-task-tracker --owner ../create-skill claim --task-id <id> --agent codex --branch <branch> --json
```

- Add evidence:

```bash
bun run coding-task-tracker --owner ../create-skill note --task-id <id> --message "<summary>" --json
```

## Migration

- Keep `TASKS.md.archive` as historical evidence.
- Completed archive bullets were imported as `Done` tracker tasks.
- Current conditional work was imported as `Backlog` with `Triage State = ready-for-human`.
- Leave migration notes in tracker task comments, not this file.

## Next Safe Action

- Run `bun run coding-task-tracker --owner ../create-skill ready --json`.
- Claim the next pickable create-skill task.
