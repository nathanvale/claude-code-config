---
name: ticket-state
description: Persistent per-ticket state management. Track pipeline stage, notes, blockers, phases, and history across sessions. Supports multi-phase tickets (impl → test → fix).
allowed-tools: Bash(git branch:*), Bash(git diff:*), Bash(ls:*), Bash(mkdir:*), Bash(~/.claude/bin/activity-log.sh:*), Read, Write, Skill
context: fork
user-invocable: false
argument-hint: <operation> [key] [options]
---

# Task

Manage persistent per-ticket pipeline state. Your arguments:
- **Operation:** `$0`
- **Key:** `$1` (ticket key like POS-3044, may be empty for `list`)
- **All args:** `$ARGUMENTS`

**State dir:** `~/.claude/state/tickets/`
**File pattern:** `~/.claude/state/tickets/<KEY>.json`
**Gathered file:** `~/.claude/state/tickets/<KEY>-gathered.json`
**Plan file pattern:** `~/.claude/plans/<KEY>-<phase>.md`

## Additional Resources

- For state JSON structure, schema versions, and migration rules, see [STATE_SCHEMA.md](STATE_SCHEMA.md)
- For extended operations (set-gathered, get-gathered, phase-add, phase-switch, phase-list), activity logging, and workflow patterns, see [OPERATIONS.md](OPERATIONS.md)

## Pipeline Stages

```
kickoff → planned → implementing → testing → qa_verified → pr_created → in_review → changes_requested → approved → merged
   0         1           2            3           4              5             6              7                8         9
```

Stage order is enforced for `advance` (forward only). Use `update --stage X` for non-linear moves.

## Step 1: Validate

Parse `$0` from `$ARGUMENTS`. It must be one of:

`init` | `get` | `update` | `advance` | `note` | `log` | `decide` | `list` | `set-gathered` | `get-gathered` | `phase-add` | `phase-switch` | `phase-list`

If `$0` is not recognized, output an error and stop:
```
### Result
Unknown operation: "$0". Expected: init, get, update, advance, note, log, decide, list, set-gathered, get-gathered, phase-add, phase-switch, phase-list.

### Context for Caller
- status: failed
- operation: $0
- error: unknown_operation
```

For all operations except `list`, `$1` (key) is required. If missing:
```
### Result
Missing ticket key. Usage: ticket-state <operation> <KEY> [options]

### Context for Caller
- status: failed
- operation: $0
- error: missing_key
```

## Step 2: Execute

### Lazy Schema Migration

Before any **write** operation (`update`, `advance`, `note`, `log`, `decide`, `set-gathered`, `phase-add`, `phase-switch`), run lazy migrations V1 through V4 in sequence if `schema_version` is behind. For **read** operations (`get`, `list`, `get-gathered`), tolerate older schemas by defaulting missing fields. Full migration rules are in [STATE_SCHEMA.md](STATE_SCHEMA.md).

### init

Create a new state file at `~/.claude/state/tickets/<KEY>.json`.

**Pre-check:** If file already exists, error:
```
### Result
State already exists for <KEY>. Use `get` to read or `update` to modify.

### Context for Caller
- status: failed
- operation: init
- key: <KEY>
- error: already_exists
```

**Populate fields:**

1. Parse optional flags from remaining args:
   - `--summary "text"` — ticket summary
   - `--type Story|Bug|Task` — ticket type
   - `--branch name` — git branch
   - `--stage name` — initial stage (default: `kickoff`)
   - `--plan-confluence URL` — Confluence plan link
   - `--plan-obsidian path` — Obsidian note path
   - `--plan-file path` — plan markdown file path

2. If `--summary` not provided, fetch from Jira:
   ```
   Skill("jira", args: "view <KEY>")
   ```
   Extract summary and type from the Jira response.

3. If `--branch` not provided, detect from git:
   ```bash
   git branch --show-current
   ```

4. Write the state file (pretty-printed, 2-space indent). See [STATE_SCHEMA.md](STATE_SCHEMA.md) for the full V4 JSON structure. Initialize with:
   - `schema_version: 4`, all collection fields as empty arrays
   - `plan` fields from flags or null
   - `multi_phase: false`, `phases: {}`, `active_phase: null`
   - One history entry: `{ "stage": "<initial>", "at": "<now>", "note": "Initialized" }`

**Output:**
```
### Result
Initialized state for <KEY>: "<summary>" at stage `<stage>`.

### Context for Caller
- status: success
- operation: init
- key: <KEY>
- stage: <stage>
- summary: <summary>
- path: ~/.claude/state/tickets/<KEY>.json
```

### get

Read and return the state file.

1. Read `~/.claude/state/tickets/<KEY>.json`
2. If file doesn't exist:
   ```
   ### Result
   No state found for <KEY>. Use `init` to create, or run `/kickoff <KEY>`.

   ### Context for Caller
   - status: not_found
   - operation: get
   - key: <KEY>
   ```

3. Parse the JSON. Tolerate older schemas — default missing fields per [STATE_SCHEMA.md](STATE_SCHEMA.md).

4. Output:
   ```
   ### Result
   **<KEY>: <summary>**
   - Stage: `<stage>` <if multi_phase: "(phase: <active_phase>)">
   - Branch: `<branch>`
   - PR: <pr.url or "None">
   - Created: <created>
   - Updated: <updated>
   - Blockers: <count> active
   - Notes: <count> entries
   - History: <count> transitions
   - Work Log: <count> entries
   - Decisions: <count> recorded
   - Linked: <count> tickets
   <if multi_phase:>
   - Phases: <phase count> (<phases.*.stage summary>)

   ### Context for Caller
   - status: success
   - operation: get
   - key: <KEY>
   - schema_version: <version>
   - stage: <stage>
   - summary: <summary>
   - branch: <branch>
   - pr_url: <pr.url or null>
   - pr_number: <pr.number or null>
   - created: <created>
   - updated: <updated>
   - blockers: <JSON array of blockers>
   - notes_count: <number>
   - history_count: <number>
   - work_log_count: <number>
   - decisions_count: <number>
   - plan_confluence: <plan.confluence or null>
   - plan_obsidian: <plan.obsidian or null>
   - plan_file: <plan.file or null>
   - gathered_file: <gathered_file or null>
   - linked_tickets: <JSON array>
   - key_files: <JSON array>
   - work_log: <JSON array>
   - decisions: <JSON array>
   - multi_phase: <boolean>
   - active_phase: <phase ID or null>
   - phases: <JSON object of phases>
   ```

### update

Modify specific fields on an existing state file.

1. Read the state file. If not found, error (same as `get`).
2. Run lazy migrations if needed.
3. Parse flags from remaining args:
   - `--stage <name>` — set stage to any valid stage (non-linear allowed)
   - `--branch <name>` — set branch
   - `--pr-url <url>` — set pr.url
   - `--pr-number <number>` — set pr.number
   - `--add-blocker "text"` — append to blockers[]
   - `--remove-blocker "text"` — remove from blockers[]
   - `--add-linked <KEY>` — append to linked_tickets[] (structured format)
   - `--relation depends-on|blocks|blocked-by|relates-to` — relation type for `--add-linked` (default: `relates-to`)
   - `--link-summary "text"` — summary for `--add-linked`
   - `--add-key-file "path"` — append to key_files[]
   - `--add-review "text"` — append to reviews[]
   - `--plan-confluence <url>` — set plan.confluence
   - `--plan-obsidian <path>` — set plan.obsidian
   - `--plan-file <path>` — set plan.file
   - `--gathered-file <path>` — set gathered_file
4. Apply changes, set `updated` to now.
5. When `--add-linked` is used, construct the structured entry:
   ```json
   { "key": "<KEY>", "relation": "<from --relation or relates-to>", "summary": "<from --link-summary or empty>" }
   ```
   Skip if that key already exists in `linked_tickets[]` (idempotent).
6. If `--stage` changed, append to history[]:
   ```json
   { "stage": "<new stage>", "at": "<ISO 8601 now>", "note": "Manual stage update" }
   ```
7. Write updated JSON back to file.

**Output:**
```
### Result
Updated <KEY>: <list of changed fields>.

### Context for Caller
- status: success
- operation: update
- key: <KEY>
- fields_updated: <comma-separated field names>
- stage: <current stage>
```

### advance

Move to the next pipeline stage (or a specific forward stage). In multi-phase mode, advances the active phase.

1. Read state file. Error if not found.
2. Run lazy migrations if needed.
3. Parse optional target stage from `$2` and `--note "text"` from remaining args.
4. Determine current stage:
   - If `multi_phase: true` AND `active_phase` is set: use `phases[active_phase].stage`
   - Otherwise: use top-level `stage`
5. Determine target:
   - If `$2` provided: validate it's a known stage AND its index > current stage index. If not forward, error:
     ```
     ### Result
     Cannot advance backward from `<current>` to `<target>`. Use `update --stage <target>` for non-linear moves.

     ### Context for Caller
     - status: failed
     - operation: advance
     - key: <KEY>
     - error: backward_advance
     - current_stage: <current>
     - target_stage: <target>
     ```
   - If `$2` not provided: move to next stage (current index + 1). If already at `merged`, error:
     ```
     ### Result
     <KEY> is already at final stage `merged`. No further advancement possible.

     ### Context for Caller
     - status: failed
     - operation: advance
     - key: <KEY>
     - error: already_final
     ```
6. Update stage:
   - If multi-phase: update `phases[active_phase].stage`
   - Also update top-level `stage` (for backwards compatibility)
   - If new stage is `merged` and multi-phase: set `phases[active_phase].completed` to now
7. Set `updated` to now, append to history[]:
   ```json
   { "stage": "<new stage>", "at": "<ISO 8601 now>", "note": "<from --note or 'Advanced from <old> to <new>'>", "phase": "<active_phase or null>" }
   ```
8. Write updated JSON.

**Output:**
```
### Result
Advanced <KEY>: `<old stage>` → `<new stage>`<if multi_phase: " (phase: <active_phase>)">.

### Context for Caller
- status: success
- operation: advance
- key: <KEY>
- previous_stage: <old>
- stage: <new>
- history_count: <number>
- phase: <active_phase or null>
- phase_completed: <true if stage is merged, false otherwise>
```

### note

Append a timestamped note.

1. Read state file. Error if not found.
2. Run lazy migrations if needed.
3. Remaining args after key form the note text.
4. Append to notes[]:
   ```json
   { "text": "<note text>", "at": "<ISO 8601 now>" }
   ```
5. Set `updated` to now.
6. Write updated JSON.

**Output:**
```
### Result
Note added to <KEY>: "<truncated note text>"

### Context for Caller
- status: success
- operation: note
- key: <KEY>
- notes_count: <number>
```

### log

Append a work log entry.

1. Read state file. Error if not found.
2. Run lazy migrations if needed.
3. Parse args:
   - `$2` — summary text (required)
   - `--commits a,b,c` — comma-separated commit SHAs (optional)
4. Auto-populate `files_changed`:
   - If `--commits` provided: `git diff --name-only <first_commit>^..<last_commit>`
   - If no commits: `git diff --name-only HEAD~1..HEAD` (last commit)
   - If git command fails, default to `[]`
5. Auto-populate `stage` from current state stage.
6. Append to `work_log[]`:
   ```json
   {
     "at": "<ISO 8601 now>",
     "summary": "<summary text>",
     "commits": ["<sha1>", "<sha2>"],
     "files_changed": ["src/file1.ts", "src/file2.ts"],
     "stage": "<current stage>"
   }
   ```
7. Set `updated` to now.
8. Write updated JSON.

**Output:**
```
### Result
Work log entry added to <KEY>: "<summary>" (<N> files, <N> commits)

### Context for Caller
- status: success
- operation: log
- key: <KEY>
- work_log_count: <number>
- files_changed: <count>
- commits: <count>
```

### decide

Record a decision with rationale.

1. Read state file. Error if not found.
2. Run lazy migrations if needed.
3. Parse args:
   - `$2` — decision text (required)
   - `--rationale "text"` — why this decision was made (required)
4. If `--rationale` missing, error:
   ```
   ### Result
   Missing --rationale flag. Usage: ticket-state decide <KEY> "decision text" --rationale "why"

   ### Context for Caller
   - status: failed
   - operation: decide
   - key: <KEY>
   - error: missing_rationale
   ```
5. Append to `decisions[]`:
   ```json
   {
     "at": "<ISO 8601 now>",
     "decision": "<decision text>",
     "rationale": "<rationale text>"
   }
   ```
6. Set `updated` to now.
7. Write updated JSON.

**Output:**
```
### Result
Decision recorded for <KEY>: "<decision text>"

### Context for Caller
- status: success
- operation: decide
- key: <KEY>
- decisions_count: <number>
```

### Extended Operations

The following operations have full documentation in [OPERATIONS.md](OPERATIONS.md). Read that file before executing these:

- **set-gathered** — Write gathered context to a separate file
- **get-gathered** — Read gathered context for a ticket
- **phase-add** — Add a new phase, converting to multi-phase mode if needed
- **phase-switch** — Switch the active phase
- **phase-list** — List all phases with status table

### list

List all ticket state files.

1. List files in `~/.claude/state/tickets/`:
   ```bash
   ls ~/.claude/state/tickets/*.json 2>/dev/null
   ```
2. If no files found:
   ```
   ### Result
   No active tickets found.

   ### Context for Caller
   - status: success
   - operation: list
   - count: 0
   - tickets: []
   ```
3. Read each file, collect key + summary + stage.
4. By default, exclude tickets where `stage === "merged"`. If `--all` flag present, include all.
5. Output:

```
### Result
| Key | Summary | Stage | Updated |
|-----|---------|-------|---------|
| POS-3044 | Distributor Specific Handling | implementing | 2026-01-29 |
| POS-3118 | Bulk Print Maintenance | testing | 2026-01-28 |

### Context for Caller
- status: success
- operation: list
- count: <number>
- tickets: [{"key": "POS-3044", "stage": "implementing"}, ...]
```

## Error Handling

| Scenario | Handling |
|----------|---------|
| Missing key | Error with usage hint |
| File not found | Suggest `init` or `/kickoff` |
| Corrupted JSON | Attempt read, if parse fails: "State file corrupted for <KEY>. Delete `~/.claude/state/tickets/<KEY>.json` and re-init." |
| Jira fetch failure on init | Warn but proceed with empty summary, ask user to provide via `--summary` |
| Invalid stage name | List valid stages in error message |
| State dir missing | Create it: `mkdir -p ~/.claude/state/tickets` |
| V1 file on write | Lazy-migrate through V2, V3, V4 before applying changes |

### Activity Logging

Log significant state changes to the central activity stream. Full logging table in [OPERATIONS.md](OPERATIONS.md).

```bash
~/.claude/bin/activity-log.sh ticket-state <op> <KEY> [extra]
```

**Log on:** `init`, `advance`, `update --stage`, `phase-add`, `phase-switch`. **Skip:** `get`, `list`, `note`, `log`, `decide`.

### Babysitter Inbox Reporting

On transient failures, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):
- `state_write_failed` — writing state JSON file fails
- `jira_fetch_failed` — Jira fetch fails during init (summary population)
