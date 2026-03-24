# Drift Conditions Reference

All drift detection rules, fix actions, and resolution logic for the `where-am-i` skill.

---

## Fix Mode Logic

All drift items (Tier 2 and Tier 3) follow the same mode-based resolution:

| Mode | Behavior |
|------|----------|
| `--fix` | Auto-apply all fixes silently |
| `--dry-run` | Report all as PENDING, no changes |
| default (interactive) | `AskUserQuestion` per item: "Fix this? <drift message>" with options "Yes, fix it" / "Skip" |

---

## Git-Only Drift (Tier 2, Step 3c)

These only need state + local git data. Checked every run.

| # | Condition | Drift Message | Fix Action |
|---|-----------|---------------|------------|
| 7 | Stage is `planned` but commits exist on branch | "Stage is `planned` but <N> commits exist on branch" | `Skill("ticket-state", args: "advance <KEY> implementing --note 'Commits detected on branch'")` |
| 8 | State has no branch set but we're on a ticket branch | "No branch recorded in state but on `<branch>`" | `Skill("ticket-state", args: "update <KEY> --branch <branch>")` |

### Phase Drift (Step 2a-extra)

If `multi_phase: true` and `detected_phase` does not match `active_phase`:
- **Drift message:** "Branch prefix suggests phase '<detected_phase>' but state shows '<active_phase>' as active"
- **Fix action:** `Skill("ticket-state", args: "phase-switch <KEY> <detected_phase>")`

---

## Network Drift (Tier 3, Step 4c)

These require PR and/or Jira data. Only checked when Tier 3 runs.

| # | Condition | Drift Message | Fix Action |
|---|-----------|---------------|------------|
| 1 | PR exists on GitHub but state.stage is before `pr_created` | "PR #N exists but state is at `<stage>`" | `Skill("ticket-state", args: "advance <KEY> pr_created --note 'PR #N detected'")` + `Skill("ticket-state", args: "update <KEY> --pr-url <url> --pr-number <number>")` |
| 2 | PR merged on GitHub but state.stage is not `merged` | "PR #N is merged but state is at `<stage>`" | `Skill("ticket-state", args: "advance <KEY> merged --note 'PR #N merged (detected)'")` |
| 3 | PR reviewDecision is APPROVED but state.stage is before `approved` | "PR approved but state is at `<stage>`" | `Skill("ticket-state", args: "advance <KEY> approved --note 'PR approved (detected)'")` |
| 4 | PR reviewDecision is CHANGES_REQUESTED but state.stage is not `changes_requested` | "Changes requested on PR but state is at `<stage>`" | `Skill("ticket-state", args: "update <KEY> --stage changes_requested")` |
| 5 | Jira status is "Done" but state.stage is not `merged` | "Jira shows Done but state is at `<stage>`" | `Skill("ticket-state", args: "advance <KEY> merged --note 'Jira marked Done'")` |
| 6 | State has PR info but no PR found on GitHub for branch | "State references PR but none found on branch `<branch>`" | `Skill("ticket-state", args: "update <KEY> --pr-url '' --pr-number ''")` |

**Extra note:** If `state.pr` is null but a PR was found, also note: "PR #N found but not recorded in state."

### Which Conditions to Check by Selection

| Selection | Conditions |
|-----------|------------|
| "Just Jira" | #5 only |
| "Just GitHub" | #1, #2, #3, #4, #6 |
| "Full refresh" | All 6 (#1-#6) |

---

## Blocker Resolution Check

For `linked_tickets` with `relation: "blocked-by"`, check Jira status (only if Jira was selected in Tier 3):

```
Skill("jira", args: "view <LINKED_KEY>")
```

If Jira status is "Done" or "Closed", add to drift:
- **Message:** "Blocker <KEY> is now resolved in Jira. Consider removing: `update <KEY> --remove-blocker '<text>'`"

---

## Activity Logging

Log drift detection and fixes to the central activity stream:

```bash
~/.claude/bin/activity-log.sh where-am-i <op> <KEY> [extra]
```

| Event | Operation | Extra Fields |
|-------|-----------|--------------|
| Run completes | `check` | `,"stage":"<stage>","drift":<count>` |
| Drift detected | `drift_detected` | `,"drift_type":"<type>","detail":"<message>"` |
| Drift fixed | `drift_fixed` | `,"drift_type":"<type>","fix":"<action>"` |

**Examples:**
```bash
~/.claude/bin/activity-log.sh where-am-i check POS-3243 ',"stage":"pr_created","drift":1'
~/.claude/bin/activity-log.sh where-am-i drift_detected POS-3243 ',"drift_type":"pr_exists_stage_drift","detail":"PR #446 exists but stage is implementing"'
~/.claude/bin/activity-log.sh where-am-i drift_fixed POS-3243 ',"drift_type":"pr_exists_stage_drift","fix":"advanced to pr_created"'
```
