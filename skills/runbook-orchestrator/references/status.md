# status subcommand

Walks the area, reads every ledger, and prints a state report plus a
"next recommended" line.

## Inputs

- `area-path` (optional) - the runbook folder path. Resolved by shared
  pre-flight (auto-discovery if not given).

## Pre-flight

Run [shared pre-flight checks](preflight.md) first. Abort on blocker;
prompt on warning. No status-specific pre-flight additions.

## Protocol

### 1. Use the seam table from pre-flight

The shared pre-flight has already validated `area-path` resolves and
that the README has a parseable seam table. Use the parsed result; do
not re-parse.

### 2. Read every ledger

For each seam, read its ledger file. Parse the table after the
`| id | signature | status | risk | summary | resolution |` header.

Skip the ledger entirely if:

- The ledger file does not exist (flag as `audit:missing-ledger`)
- The table header line is missing (flag as `audit:malformed-ledger`)
- The ledger contains only header rows and the separator (treat as
  zero data rows - state is "untouched")

### 3. Classify each seam

For each seam, compute its state:

| State | Condition |
| --- | --- |
| `untouched` | Ledger has zero data rows |
| `converged` | Every data row is `fixed` or `closed` |
| `awaiting-decision` | At least one row is `open` with resolution containing `pending-nathan` |
| `in-progress` | At least one `open` row, none awaiting decision (the loop can proceed autonomously) |
| `blocked` | Every `open` row is awaiting-decision AND there are at least 2 such rows (the loop cannot make progress without user input) |

Also compute per-seam counts:

- total findings
- by status: open, fixed, closed
- by risk: low, high
- awaiting-decision count

### 4. Recommend next seam

Read the `## Suggested execution order` section (optional). For each
ordered seam:

- If the seam is `converged` -> skip, move to next in order
- If the seam is `untouched` -> recommend it
- If the seam is `in-progress` -> recommend resuming it
- If the seam is `awaiting-decision` -> recommend it with an
  "**decisions pending**" tag
- If the seam is `blocked` -> recommend it with a "**blocked**" tag and
  surface the awaiting-decision rows

If there's no `## Suggested execution order`, recommend the first
non-converged seam in the table.

If every seam is `converged`, report "all seams converged" and recommend
the user run `audit` to verify no drift.

### 5. Print the status block

Use this format:

```
# Runbook status: <area-path>

| Seam | State | Open | Fixed | Closed | High-risk | Pending |
| --- | --- | --- | --- | --- | --- | --- |
| Selection contract | converged | 0 | 5 | 4 | 0 | 0 |
| Column-filter binding | awaiting-decision | 7 | 0 | 1 | 7 | 7 |
| Header adapter | untouched | 0 | 0 | 0 | 0 | 0 |
| ... | | | | | | |

## Next recommended

**Column-filter binding** - 7 high-risk findings awaiting your decision.

To resume:

`/goal Follow docs/runbooks/<area>/column-filter-binding.md ...`

(the assembled invocation is available via
`/runbook-orchestrator launch <area> column-filter-binding`)

## Notes

- Header adapter is untouched - next in execution order after current
  loop closes.
- Pagination footer is untouched but small - good for a fast loop.
- All cross-cutting loops (memoisation, virtualisation, accessibility,
  wcag-hunter, bundle-externals) blocked by contract loops per execution
  order.
```

## Edge cases

### Multiple seams in `awaiting-decision`

List them all in the "next recommended" section, ranked by:

1. Earliest position in execution order
2. Number of awaiting-decision rows (more pending = higher priority)

### Conflicting execution order vs current state

If execution order says "memoisation next" but selection is still
in-progress, surface the conflict:

```
## Conflict

Execution order says memoisation is next, but selection is still
in-progress (3 open findings). Recommend finishing selection first.
Override with: /runbook-orchestrator launch <area> memoisation
```

### Stale `pending-nathan` rows

If a row has been `pending-nathan` for more than 7 days (heuristic:
ledger row's nearest git commit is more than 7 days old), tag it
`**stale decision**` in the status block. Suggest the user either decide
or close it.

(Implementation: shell out to `git log -1 --format=%cr <ledger-file>`
or check `git blame` per row. Best-effort; skip if blame is too
expensive.)

## What to NOT do

- Do not edit any ledger or runbook during status. Read-only.
- Do not assume signature uniqueness across seams - some signatures may
  legitimately appear in multiple seams (e.g. a memoisation issue that
  also surfaces in the contract loop).
- Do not parse the runbook bodies for status - the ledger is the truth.
  Runbook content is for `launch` and `audit`.
