# State Schema Reference

Supporting reference for the `ticket-state` skill. See [SKILL.md](SKILL.md) for the core workflow.

## State JSON Structure

Each ticket state file lives at `~/.claude/state/tickets/<KEY>.json`.

```json
{
  "schema_version": 4,
  "key": "<KEY>",
  "summary": "<ticket summary>",
  "type": "<Story|Bug|Task>",
  "stage": "<pipeline stage>",
  "branch": "<git branch>",
  "pr": { "url": "<PR URL>", "number": "<PR number>" },
  "created": "<ISO 8601>",
  "updated": "<ISO 8601>",
  "history": [
    { "stage": "<stage>", "at": "<ISO 8601>", "note": "<text>", "phase": "<phase or null>" }
  ],
  "plan": {
    "confluence": "<URL or null>",
    "obsidian": "<path or null>",
    "file": "<path or null>"
  },
  "gathered_file": "<path or null>",
  "blockers": ["<text>"],
  "linked_tickets": [
    { "key": "<KEY>", "relation": "depends-on|blocks|blocked-by|relates-to", "summary": "<text>" }
  ],
  "key_files": ["<path>"],
  "reviews": ["<text>"],
  "notes": [
    { "text": "<text>", "at": "<ISO 8601>" }
  ],
  "work_log": [
    {
      "at": "<ISO 8601>",
      "summary": "<text>",
      "commits": ["<sha>"],
      "files_changed": ["<path>"],
      "stage": "<stage at time of log>"
    }
  ],
  "decisions": [
    {
      "at": "<ISO 8601>",
      "decision": "<text>",
      "rationale": "<text>"
    }
  ],
  "multi_phase": false,
  "phases": {
    "<phase_id>": {
      "branch": "<git branch>",
      "stage": "<pipeline stage>",
      "pr": null,
      "created": "<ISO 8601>",
      "completed": "<ISO 8601 or null>"
    }
  },
  "active_phase": "<phase_id or null>"
}
```

## Gathered Context File

Stored separately at `~/.claude/state/tickets/<KEY>-gathered.json` to keep main state lean.

## Branch to Phase Mapping

| Branch Pattern | Phase ID | Purpose |
|----------------|----------|---------|
| `feat/<KEY>-*` | `impl` | Main implementation |
| `test/<KEY>-*` | `test` | Follow-up Cypress/E2E tests |
| `fix/<KEY>-*` | `fix` | Bug fixes post-merge |
| `docs/<KEY>-*` | `docs` | Documentation updates |
| `chore/<KEY>-*` | `chore` | Maintenance tasks |

## Multi-Phase Architecture

When `multi_phase: false` and `phases: {}` is empty, the ticket operates in legacy single-phase mode. All operations work on top-level fields directly.

When `phase-add` is called, the ticket converts to multi-phase mode:
- Current state migrates into the first phase (`impl`)
- `multi_phase` becomes `true`
- `active_phase` tracks which phase is current
- Top-level `stage`, `branch`, `pr` are synced from `phases[active_phase]` for backwards compatibility
- `phases[active_phase]` is authoritative in multi-phase mode

## Schema Evolution

### V1 (Original)

The initial schema. No `schema_version` field. Missing:
- `work_log`
- `decisions`
- `linked_tickets` was a flat array of strings (e.g., `["POS-XXXX"]`)

### V2 (Work Log + Decisions)

Added `schema_version: 2` plus:
- `work_log: []`
- `decisions: []`
- Structured `linked_tickets`: each string `"POS-XXXX"` becomes `{ "key": "POS-XXXX", "relation": "relates-to", "summary": "" }`

### V3 (Plan File + Gathered)

Added `schema_version: 3` plus:
- `plan.file: null` (alongside existing `plan.confluence` and `plan.obsidian`)
- `gathered_file: null`

### V4 (Multi-Phase Support)

Added `schema_version: 4` plus:
- `multi_phase: false`
- `phases: {}`
- `active_phase: null`

## Lazy Migration Rules

Migrations run **only on write operations** (`update`, `advance`, `note`, `log`, `decide`, `set-gathered`, `phase-add`, `phase-switch`). Read operations (`get`, `list`, `get-gathered`) tolerate older schemas by defaulting missing fields.

### V1 to V2

Trigger: missing `schema_version` or `schema_version < 2`.

1. Set `schema_version: 2`
2. Add `work_log: []` if missing
3. Add `decisions: []` if missing
4. Convert flat `linked_tickets` strings to structured format:
   - Each string `"POS-XXXX"` becomes `{ "key": "POS-XXXX", "relation": "relates-to", "summary": "" }`
5. Continue with the requested write operation (migration saved as part of the write)

### V2 to V3

Trigger: `schema_version < 3`.

1. Set `schema_version: 3`
2. If `plan` object exists, add `plan.file: null` (preserve existing `confluence`/`obsidian` values)
3. If `plan` object missing, add full `plan: { confluence: null, obsidian: null, file: null }`
4. Add `gathered_file: null`
5. Continue with the requested write operation

### V3 to V4

Trigger: `schema_version < 4`.

1. Set `schema_version: 4`
2. Add `multi_phase: false` (single-phase ticket, legacy mode)
3. Add `phases: {}` (empty, populated on first `phase-add`)
4. Add `active_phase: null` (null means legacy single-phase mode)
5. Continue with the requested write operation

### Read Tolerance Defaults

When reading older schema versions, apply these defaults without writing:

| Field | V1 Default | V2 Default | V3 Default |
|-------|-----------|-----------|-----------|
| `schema_version` | `1` | -- | -- |
| `work_log` | `[]` | -- | -- |
| `decisions` | `[]` | -- | -- |
| `linked_tickets` | Convert strings to structured | -- | -- |
| `plan.file` | -- | -- | `null` |
| `gathered_file` | -- | -- | `null` |
| `multi_phase` | -- | -- | `false` |
| `phases` | -- | -- | `{}` |
| `active_phase` | -- | -- | `null` |
