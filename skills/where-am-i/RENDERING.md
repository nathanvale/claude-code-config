# Rendering Reference

All output format specifications for the `where-am-i` skill's progressive rendering tiers.

---

## Tier 1: Full Panel (Step 2c)

Output this entire panel BEFORE proceeding to Tier 2. The user must see it immediately.

### Header + Pipeline Visualization

```
## <KEY>: <summary>

> Git: <staleness> | Jira: <staleness> | GitHub: <staleness>

kickoff - planned - [implementing] - testing - qa_verified - pr_created - in_review - approved - merged
                     ^^^ HERE
```

Pipeline rendering rules:
- List all stages separated by ` - `
- Wrap the current stage in `[brackets]`
- On the next line, position `^^^ HERE` under the bracketed stage

### Context Table

```
### Context
| Field       | Value                                      |
|-------------|--------------------------------------------|
| Branch      | <state.branch>                             |
| Stage       | <state.stage>                              |
| Phase       | <state.active_phase or "---"> <if multi_phase show "(multi-phase)">  |
| Jira Status | <live_snapshot.jira_status or "---">        |
| PR          | <from state.pr or "None">                  |
| Git Status  | <live_snapshot.git_status or "---">         |
| Commits     | <live_snapshot.commits_ahead or "---">      |
| Updated     | <state.updated, formatted DD Mon HH:mm>    |
```

Field rules:
- **Phase row:** Only show if `multi_phase: true` or `active_phase` is set
- **Branch:** from `state.branch` (always available)
- **Stage:** from `state.stage` (always available)
- **Jira Status:** from `live_snapshot.jira_status` if present, else `---`
- **PR:** if `state.pr` is non-null, show `#<number> (cached)`. If null, show `None`
- **Git Status:** from `live_snapshot.git_status` if present, else `---`
- **Commits:** from `live_snapshot.commits_ahead` if present, else `---`
- **Updated:** from `state.updated`, formatted as `DD Mon HH:mm`

### Dependencies (from linked_tickets[])

Only show if `linked_tickets[]` is non-empty.

```
### Dependencies
- <key>: <summary> [<relation>]
```

### Phases (multi-phase tickets only)

Only show if `multi_phase: true` AND `phases` has more than one entry.

```
### Phases
| Phase | Stage | PR | Completed |
|-------|-------|----|-----------|
| impl* | merged | #441 | 02 Feb |
| test  | implementing | --- | --- |

*Active phase
```

Format notes:
- Mark active phase with `*`
- Show `---` for null PR or completed values
- If all phases are `merged`, show: "All phases for <KEY> complete."

### Recent Work (from work_log[], last 2 entries)

Only show if `work_log[]` is non-empty.

```
### Recent Work
- [DD Mon] <summary> (<N> files, <N> commits)
```

Omit file/commit counts if zero.

### Key Decisions (from decisions[])

Only show if `decisions[]` is non-empty.

```
### Key Decisions
- <decision> (<rationale summary>)
```

### Blockers (if any)

Only show if `blockers[]` is non-empty.

```
### Blockers
- <blocker text>
```

### Recent Notes (last 3)

Only show if `notes[]` is non-empty.

```
### Recent Notes
- [DD Mon] <note text>
```

### Suggested Next Action

Based on `state.stage`:

| Stage | Suggestion |
|-------|-----------|
| `kickoff` (no gathered file) | "Run `/kickoff <KEY>` to explore the ticket and gather context." |
| `kickoff` (gathered file exists) | "Kickoff gathered context. Run `/plan <KEY>` to start interactive planning." |
| `planned` | "Start implementing. First commit will advance to `implementing`." |
| `implementing` | "Continue coding. When ready, run `/qa-test <KEY>` to verify ACs (auto-advances to `testing`)." |
| `testing` | "Testing in progress. Run `/qa-test <KEY>` to verify ACs in browser." |
| `qa_verified` | "QA verified. Run `/git pr-create` to open a PR." |
| `pr_created` | "PR is open. Run `/review-workflow <PR#>` for self-review." |
| `in_review` | "Waiting for review. Check PR comments." |
| `changes_requested` | "Address review feedback. Push changes and request re-review." |
| `approved` | "PR approved! Run `/git pr-merge <PR#>` when ready." |
| `merged` | "Done! Move Jira to Done if not already." |

```
### Suggested Next Action
<suggestion text>
```

If drift was detected, prepend:
```
### Suggested Next Action
**Drift detected** --- consider fixing the items above first.
<original stage-based suggestion>
```

### Remaining Pipeline

Only render when `state.stage` is NOT `merged`.

Show all stages from the **stage after current** through `merged`, each with its action:

| Stage | Action |
|-------|--------|
| `kickoff` | `/kickoff <KEY>` --- explore ticket and gather context |
| `planned` | `/plan <KEY>` --- create implementation plan |
| `implementing` | Code, then `/git commit` to save progress |
| `testing` | `/qa-test <KEY>` --- verify acceptance criteria in browser |
| `qa_verified` | `/git pr-create` --- create pull request |
| `pr_created` | `/review-workflow <PR#>` --- self-review before requesting review |
| `in_review` | Wait for reviewer feedback, check PR comments |
| `changes_requested` | Address feedback, push changes, request re-review |
| `approved` | Merge the PR |
| `merged` | Move Jira to Done if not already |

Rendering rules:
- Start from the stage **immediately after** `state.stage` --- skip all stages up to and including current
- If stage is `changes_requested`, resume from `in_review` (re-review cycle)
- Number the remaining steps starting from 1

```
### Remaining Pipeline
1. **testing** --- Run tests, then `/pr-create` to open a PR
2. **pr_created** --- `/review-workflow <PR#>` --- self-review before requesting review
3. **in_review** --- Wait for reviewer feedback, check PR comments
4. **approved** --- Merge the PR
5. **merged** --- Move Jira to Done if not already
```

---

## Tier 2: Local Git Update (Step 3d)

Compact update appended below the Tier 1 panel:

```
---
**Git:** <N> modified, <N> untracked, <N> staged | <N> commits on branch
**Ecosystem:** healthy
```

If ecosystem issues:
```
**Ecosystem:**
- <N> unresolved issues --- run `/babysitter`
- MISSING: <skill name>
- CORRUPTED: <file>
```

If git drift was detected and fixed/skipped:
```
**Git Drift:**
- <drift message> [FIXED|SKIPPED|PENDING]
```

If no git drift:
```
**Git Drift:** None
```

---

## Tier 3: Network Update (Step 4d)

```
---
### Network Refresh
| Source | Status | Changed? |
|--------|--------|----------|
| Jira   | <status> | <Yes/No> |
| GitHub | <PR info or "No PR"> | <Yes/No> |
```

If drift items found:
```
### Drift Detected
- <drift message> -> Fix: `<fix command>` [FIXED|SKIPPED|PENDING]
```

If no drift:
```
### Drift
No drift detected --- state is consistent with live data.
```

---

## Final Summary (Step 5)

If any drift was fixed across Tier 2 and Tier 3:
```
### Summary
<N> drift items fixed, <N> skipped.
```

---

## Output Contract

For programmatic callers (when invoked via Skill fork):

```
### Result
<KEY> at stage `<stage>`. <N> drift items detected.

### Context for Caller
- status: success|failed
- operation: where-am-i
- key: <KEY>
- stage: <stage>
- drift_count: <N>
- tier_reached: <1|2|3>
```
