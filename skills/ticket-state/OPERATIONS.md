# Extended Operations Reference

Supporting reference for the `ticket-state` skill. See [SKILL.md](SKILL.md) for core operations.

## set-gathered

Write gathered context to a separate file, keeping the main state lean.

1. Read state file for `<KEY>`. Error if not found.
2. Run lazy migrations if needed.
3. `$2` is the JSON string containing gathered context.
4. Write JSON to `~/.claude/state/tickets/<KEY>-gathered.json` (pretty-printed, 2-space indent).
   - If file already exists, deep merge: `repos.primary` appends (dedup by path), `ticket` fields overwrite, arrays union by identity.
5. Set `gathered_file` to `~/.claude/state/tickets/<KEY>-gathered.json` in main state.
6. Set `updated` to now.
7. Write updated main state JSON.

**Output:**
```
### Result
Gathered context saved for <KEY>: <ticket summary>, <N> key files, <N> dependencies.

### Context for Caller
- status: success
- operation: set-gathered
- key: <KEY>
- gathered_file: ~/.claude/state/tickets/<KEY>-gathered.json
- ticket_summary: <ticket.summary or null>
- key_files_count: <number>
- dependencies_count: <number>
```

## get-gathered

Read the gathered context file for a ticket.

1. Read state file for `<KEY>`. If not found, check directly for `~/.claude/state/tickets/<KEY>-gathered.json`.
2. If gathered file not found:
   ```
   ### Result
   No gathered context found for <KEY>. Run `/kickoff <KEY>` to explore the ticket.

   ### Context for Caller
   - status: not_found
   - operation: get-gathered
   - key: <KEY>
   ```
3. Read and parse the gathered JSON.
4. Output:
   ```
   ### Result
   **Gathered Context: <KEY>**
   - **Ticket:** <ticket.summary> (<ticket.type>)
   - **ACs:** <count> acceptance criteria
   - **Figma:** <figma.notes or "N frames captured">
   - **Repos:** <count> primary, <count> dependency
   - **Gaps:** <count> missing types, <count> missing tests, <count> quality issues

   ### Context for Caller
   - status: success
   - operation: get-gathered
   - key: <KEY>
   - gathered_file: <path>
   - gathered_json: <full JSON content>
   ```

## phase-add

Add a new phase to an existing ticket, converting it to multi-phase mode if needed.

1. Read state file for `<KEY>`. Error if not found.
2. Run lazy migrations (including V3 to V4).
3. Parse args:
   - `$2` -- phase ID (required): `impl` | `test` | `fix` | `docs` | `chore`
   - `--branch <name>` -- branch for this phase (optional, defaults to current git branch)
4. If phase ID already exists in `phases[]`:
   ```
   ### Result
   Phase `<phase>` already exists for <KEY>.

   ### Context for Caller
   - status: failed
   - operation: phase-add
   - key: <KEY>
   - error: phase_exists
   - phase: <phase>
   ```
5. If ticket is single-phase (`multi_phase: false`):
   a. Convert to multi-phase by migrating current state into first phase:
      - Create `phases.impl` from current `stage`, `branch`, `pr`, `created`
      - Set `phases.impl.stage` to current `stage`
      - Set `phases.impl.completed` to `updated` if `stage === "merged"`, else `null`
   b. Set `multi_phase: true`
   c. Note: The legacy `stage`, `branch`, `pr` fields are preserved for backwards compatibility but `phases[active_phase]` is authoritative in multi-phase mode.
6. If `--branch` not provided, detect from git:
   ```bash
   git branch --show-current
   ```
7. Create new phase entry in `phases`:
   ```json
   {
     "<phase>": {
       "branch": "<from flag or git>",
       "stage": "kickoff",
       "pr": null,
       "created": "<ISO 8601 now>",
       "completed": null
     }
   }
   ```
8. Set `active_phase` to the new phase.
9. Update legacy top-level fields to match active phase:
   - `branch` = `phases[active_phase].branch`
   - `stage` = `phases[active_phase].stage`
   - `pr` = `phases[active_phase].pr`
10. Set `updated` to now.
11. Append to `history[]`:
    ```json
    { "stage": "kickoff", "at": "<ISO 8601 now>", "note": "Started phase: <phase>", "phase": "<phase>" }
    ```
12. Write updated JSON.

**Output:**
```
### Result
Added phase `<phase>` to <KEY>. Active phase switched to `<phase>`.

### Context for Caller
- status: success
- operation: phase-add
- key: <KEY>
- phase: <phase>
- branch: <branch>
- active_phase: <phase>
- phase_count: <number>
```

## phase-switch

Switch the active phase for a multi-phase ticket.

1. Read state file for `<KEY>`. Error if not found.
2. Run lazy migrations.
3. Parse `$2` -- phase ID (required).
4. If ticket is not multi-phase (`multi_phase: false`) or `phases` is empty:
   ```
   ### Result
   <KEY> is not a multi-phase ticket. Use `phase-add` first.

   ### Context for Caller
   - status: failed
   - operation: phase-switch
   - key: <KEY>
   - error: not_multi_phase
   ```
5. If phase ID does not exist in `phases`:
   ```
   ### Result
   Phase `<phase>` not found for <KEY>. Available: <phases list>.

   ### Context for Caller
   - status: failed
   - operation: phase-switch
   - key: <KEY>
   - error: phase_not_found
   - phase: <phase>
   - available_phases: <JSON array of phase IDs>
   ```
6. Update `active_phase` to `$2`.
7. Sync legacy top-level fields from active phase:
   - `branch` = `phases[active_phase].branch`
   - `stage` = `phases[active_phase].stage`
   - `pr` = `phases[active_phase].pr`
8. Set `updated` to now.
9. Append to `history[]`:
   ```json
   { "stage": "<phases[active_phase].stage>", "at": "<ISO 8601 now>", "note": "Switched to phase: <phase>", "phase": "<phase>" }
   ```
10. Write updated JSON.

**Output:**
```
### Result
Switched <KEY> to phase `<phase>` at stage `<stage>`.

### Context for Caller
- status: success
- operation: phase-switch
- key: <KEY>
- phase: <phase>
- stage: <phases[phase].stage>
- branch: <phases[phase].branch>
```

## phase-list

List all phases for a multi-phase ticket.

1. Read state file for `<KEY>`. Error if not found.
2. If ticket is not multi-phase or `phases` is empty:
   ```
   ### Result
   <KEY> is a single-phase ticket at stage `<stage>`.

   ### Context for Caller
   - status: success
   - operation: phase-list
   - key: <KEY>
   - multi_phase: false
   - stage: <stage>
   ```
3. Build phase summary table:
   ```
   ### Result
   **Phases for <KEY>:**
   | Phase | Stage | Branch | PR | Completed |
   |-------|-------|--------|----|-----------|
   | impl* | merged | feat/POS-3044-... | #441 | 2026-02-02 |
   | test  | implementing | test/POS-3044-... | --- | --- |

   *Active phase

   ### Context for Caller
   - status: success
   - operation: phase-list
   - key: <KEY>
   - multi_phase: true
   - active_phase: <active_phase>
   - phase_count: <number>
   - phases: <JSON object of phases>
   ```

Mark active phase with `*` suffix. Show "---" for null values.

## Activity Logging

Log significant state changes to the central activity stream for observability:

```bash
~/.claude/bin/activity-log.sh ticket-state <op> <KEY> [extra]
```

**When to log:**

| Operation | Log? | Extra Fields |
|-----------|------|--------------|
| `init` | Yes | `,"stage":"kickoff"` |
| `advance` | Yes | `,"from":"<old>","to":"<new>"` |
| `update --stage` | Yes | `,"from":"<old>","to":"<new>"` |
| `phase-add` | Yes | `,"phase":"<phase>"` |
| `phase-switch` | Yes | `,"phase":"<phase>"` |
| `get`, `list` | No | -- |
| `note`, `log`, `decide` | No | -- |

**Example:**
```bash
~/.claude/bin/activity-log.sh ticket-state init POS-3243 ',"stage":"kickoff"'
~/.claude/bin/activity-log.sh ticket-state advance POS-3243 ',"from":"planned","to":"implementing"'
```

## Babysitter Inbox Reporting

On transient failures, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):
- `state_write_failed` -- writing state JSON file fails
- `jira_fetch_failed` -- Jira fetch fails during init (summary population)

## Common Workflow Patterns

### New Ticket (Single Phase)

```
init POS-XXXX --> advance POS-XXXX planned --> advance POS-XXXX implementing --> ... --> advance POS-XXXX merged
```

### Multi-Phase Ticket (impl then test)

```
init POS-XXXX                      # Creates ticket, starts at kickoff
advance POS-XXXX merged            # Complete implementation phase
phase-add POS-XXXX test            # Converts to multi-phase, adds test phase at kickoff
advance POS-XXXX implementing      # Advance test phase
advance POS-XXXX merged            # Complete test phase
```

### Switching Between Phases

```
phase-list POS-XXXX                # See all phases and their stages
phase-switch POS-XXXX impl         # Switch back to impl phase
get POS-XXXX                       # Verify active phase context
phase-switch POS-XXXX test         # Switch to test phase
```
