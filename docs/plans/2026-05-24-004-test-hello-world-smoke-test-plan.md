---
title: "test: hello world for issue-to-pr skill test drive"
type: test
status: active
created: 2026-05-24
issue: 68
issue_url: "https://github.com/nathanvale/claude-code-config/issues/68"
depth: lightweight
---

# test: hello world for issue-to-pr skill test drive

## Summary

Smoke-test the `issue-to-pr` skill end-to-end by landing a trivially scoped,
throwaway change: create a single docs-only file at `docs/scratch/hello-world.md`
with fixed content, then ship it as a PR against `main`. The point is to verify
the pipeline produces a working PR, not to deliver product behavior.

## Problem Frame

The `issue-to-pr` v2 workflow needs an end-to-end exercise with the smallest
possible real change so the orchestration loop, stage shells, ledger
checkpoints, and ship path can be validated without the noise of a substantive
feature. Issue #68 supplies that minimal change: one new markdown file.

## Scope

In scope:

- Create `docs/scratch/hello-world.md` (creating `docs/scratch/` if absent) with
  the exact content specified by the issue.
- Open a PR against `main` linking issue #68 (handled by the ship stage).

### Deferred to Follow-Up Work

- Reverting or deleting the scratch file after the smoke test completes
  (throwaway scope, per the issue notes).

Out of scope:

- Any tooling, CI, or configuration change.
- Any test code (the change carries no behavior to test).

## Requirements Traceability

| AC | Requirement | Where addressed |
| --- | --- | --- |
| 1 | New file `docs/scratch/hello-world.md` exists with the content above | U1 |
| 2 | A PR is opened against `main` linking to this issue | Stage 6 ship (workflow outcome); covered by U1 `ac_mapping` |
| 3 | CI passes (or is skipped; nothing here should trigger CI) | Stage 6 ship (workflow outcome); covered by U1 `ac_mapping` |

AC2 and AC3 are workflow-stage outcomes of shipping the single change in U1, not
separate implementation units. They map onto U1 so every AC index has coverage.

## Implementation Units

### U1. Create the hello-world scratch file

**Goal:** A new file `docs/scratch/hello-world.md` exists with the exact content
specified by the issue.

**Requirements:** AC1 (primary); AC2 and AC3 follow from shipping this change.

**Dependencies:** None.

**Files:**

- `docs/scratch/hello-world.md` (create; create the `docs/scratch/` directory if
  it does not exist)

**Approach:** Write the file with exactly this content (no extra trailing or
leading content):

```
# Hello, world

This file exists to verify the issue-to-pr skill produces a working PR end-to-end.
```

**Execution note:** Docs-only change. A red test or proof would be artificial, so
this unit uses `change_first` execution mode.

**Test scenarios:** Test expectation: none -- pure docs file with no behavior to
assert. Verification is by file existence and exact content match.

**Verification:** `docs/scratch/hello-world.md` exists, its content matches the
block above byte-for-byte, and no other files are changed by this unit.

```yaml
id: hello-world-file
name: Create the hello-world scratch file
goal: A new file docs/scratch/hello-world.md exists with the content specified by the issue.
files:
  - docs/scratch/hello-world.md
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 1 holds: docs/scratch/hello-world.md exists with the exact specified content (heading line plus the verification sentence)."
  - "AC 2 holds: the change is shippable as a single-file PR against main linking issue #68."
  - "AC 3 holds: the change is docs-only and triggers no CI, so CI passes or is skipped."
ac_mapping:
  - 1
  - 2
  - 3
rationale: "docs-only change_first; AC2/AC3 are ship-stage outcomes mapped here so every AC index is covered without inventing non-implementation units."
```

## System-Wide Impact

None. The file lives under `docs/scratch/`, is not imported, referenced, or
linked by any other file, and carries no behavior.

## Risks

- Content drift: the file content must match the issue byte-for-byte. Mitigation:
  copy the exact block; verify on convergence.
- Accidental scope creep (creating extra files or directories). Mitigation: the
  single-unit, single-file contract makes any extra touched file a finding.
