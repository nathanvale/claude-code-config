# Rename Leftovers Allowlist

Audit command:

```sh
rg -n 'create-cli|Create CLI|create cli|create-cli-scripts|skills/create-cli|/create-cli'
```

## Stable Patterns

| Pattern | Classification | Action | Owner | Reason |
|---|---|---|---|---|
| `skills/cli-author/references/rename-leftovers-allowlist.md:*` | allowlist self-reference | leave | `skills/cli-author/references/rename-leftovers-allowlist.md` | This file names the audit command and approved leftover patterns. |
| `skills/skill-feedback/**` | deferred owner | leave | `skills/skill-feedback/SKILL.md` | Out of scope for this rename; existing dirty/active owner area remains untouched. |
| `docs/plans/2026-07-01-001-refactor-rename-cli-skill-to-cli-author-plan.md:*` | rename plan | leave | `docs/plans/2026-07-01-001-refactor-rename-cli-skill-to-cli-author-plan.md` | Current implementation plan records the old slug as the subject being renamed. |

## Public API Pattern

| Pattern | Classification | Action | Owner | Reason |
|---|---|---|---|---|
| `createCli*` | public API | leave | `runtime/cli-command-facade/src/runtime-envelope.ts` and `runtime/cli-command-facade/src/cli-diagnostics.ts` | Facade helper names are package API, not skill slug references. |
