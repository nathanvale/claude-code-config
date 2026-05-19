# audit subcommand

Checks runbook health across the area. Read-only. Reports findings; does
not auto-fix.

## Inputs

- `area-path` (required) - the runbook folder path

## Pre-flight

Run [shared pre-flight checks](preflight.md) first. Audit-specific
notes:

- **Missing seam pairs** are warn (not blocker) - audit should still
  run on the seams that do exist and report the missing ones as
  findings.
- **Git unavailable** is warn - audit continues but skips
  check 2 (ledger -> commit drift) and check 9 (stale pending-nathan
  rows). Both are skipped with a single info row noting the skip.

## Protocol

Run every check below. Group findings by severity:

- **blocker** - the orchestrator cannot function until fixed (e.g. README
  unparseable, seam table missing)
- **warn** - the loop will work but may drift over time (e.g. ledger row
  points at a deleted commit)
- **info** - cosmetic or stylistic drift (e.g. heading text doesn't match
  convention but is parseable)

### Check 1: file-existence

For every runbook in the area, read its `## Files in scope` section. For
each bulleted file path, check whether it exists on disk.

Glob patterns (`packages/.../*`, `__tests__/.../**/*`) - check that the
glob has at least one match. Specific paths - check directly.

Finding: `audit:missing-file`

```
| seam | severity | finding |
| --- | --- | --- |
| selection | warn | File in scope no longer exists: packages/portal-ui/src/ui/data-table/selection/legacyHelper.ts |
```

### Check 2: ledger -> commit drift

For every `fixed` ledger row with `resolution: commit <sha>`:

- Run `git cat-file -e <sha>` to check the commit still exists
- If missing -> finding: `audit:rewritten-history`
- If exists -> ok, no finding

```
| seam | severity | finding |
| --- | --- | --- |
| selection | warn | Ledger row 003 references commit abc1234 which is not in git log (rebased or force-pushed?) |
```

### Check 3: signature uniqueness within seam

For each seam's ledger, build a set of signatures. Flag duplicates.

Finding: `audit:duplicate-signature`

```
| seam | severity | finding |
| --- | --- | --- |
| column-filter-binding | blocker | Signature "filter-row-narrowing" appears in rows 002 and 005 |
```

### Check 4: signature collisions across seams

Build a global map of signature -> [seam, row-id]. If a signature appears
in multiple seams, flag for review. Some collisions are intentional (a
single finding that surfaces in two reviews) - the user decides whether
to suppress.

Finding: `audit:cross-seam-signature`

```
| seams | severity | finding |
| --- | --- | --- |
| selection, memoisation | info | Signature "selection-snapshot-identity-churn" appears in both seams |
```

### Check 5: ADR reference drift

For every ledger row with `resolution` matching `ADR-contradicts-<adr-id>`
or any other `ADR-*` close reason:

- Try to locate `docs/adr/<adr-id>*.md` (glob)
- If missing -> finding: `audit:adr-deleted`

Finding: `audit:adr-deleted`

```
| seam | severity | finding |
| --- | --- | --- |
| header-adapter | warn | Ledger row 004 closed with reason ADR-contradicts-0007 but docs/adr/0007*.md does not exist |
```

### Check 6: convention adherence

For every runbook in the area, check the required sections exist:

- `## Files in scope`
- `## Suggested reviewer personas`
- `## ADR guardrails`
- `## Scoped audit prompt`

Finding: `audit:convention-missing-section`

```
| seam | severity | finding |
| --- | --- | --- |
| virtualisation | warn | Missing required section: ## Suggested reviewer personas |
```

### Check 7: README convention adherence

Check the README has:

- `## Why these seams` section with a parseable seam table
- `## Invocation` section with one sub-heading per seam in the seam table
- `## Turn protocol` or `## Turn protocol (shared)` section
- Optional: `## Suggested execution order`, `## Risk classification`,
  `## Fix protocol`

Finding: `audit:readme-convention-missing-section`

### Check 8: invocation block parseability

For each sub-heading in `## Invocation`, check:

- A fenced code block follows the sub-heading
- The fenced block starts with `/goal` or `/loop`
- The seam name in the sub-heading matches a row in the seam table

Finding: `audit:invocation-missing-or-malformed`

### Check 9: stale pending-nathan rows

For each `open` row with resolution `pending-nathan` (or similar
user-pending marker):

- Look up the row's last-modified date via `git log -1 --format=%cI -- <ledger-file>`
- If older than 7 days -> finding: `audit:stale-pending-decision`

This is best-effort; skip if git is too expensive or the ledger has been
edited many times since the row was added (the row's specific age is
harder to determine).

Finding: `audit:stale-pending-decision`

### Check 10: orphan ledger / orphan runbook

For each `.md` file in the area:

- If `<name>.md` exists but `<name>-ledger.md` does not (and the file
  isn't README) -> finding: `audit:orphan-runbook`
- If `<name>-ledger.md` exists but `<name>.md` does not -> finding:
  `audit:orphan-ledger`
- If a `<name>.md` exists but is not in the README's seam table ->
  finding: `audit:unreferenced-runbook`

## Output format

```
# Runbook audit: <area-path>

Run at: <timestamp>
Files audited: <count>

## Blockers (<count>)

| seam | finding |
| --- | --- |
| ... | ... |

## Warnings (<count>)

| seam | finding |
| --- | --- |
| ... | ... |

## Info (<count>)

| seam | finding |
| --- | --- |
| ... | ... |

## Summary

- N missing files
- N rewritten commits
- N convention violations
- N stale pending decisions

Recommended next actions:

1. <highest-priority blocker fix>
2. <warning fix>
3. <info: cosmetic>
```

## What to NOT do

- Do not auto-fix anything. Report only. The user decides.
- Do not modify the audited files. Read-only.
- Do not assume git is available - if `git cat-file` fails (not a git
  repo, git not on PATH), skip the commit-drift check and report
  `audit:skipped:git-unavailable`.
- Do not run the audit as part of `status` - keep them separate so
  `status` stays fast.

## When to run audit

Suggested cadence:

- Before launching a new seam (catch convention drift early)
- After a rebase or force-push (catch rewritten history)
- When a runbook starts producing weird `/ce-code-review` output (the
  audit may surface a missing-file that's confusing the review)
- Quarterly, as a hygiene pass
