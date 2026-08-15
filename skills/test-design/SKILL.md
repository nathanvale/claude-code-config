---
name: test-design
description: "Creating or changing tests, fixtures, mocks, snapshots, test helpers, or test harnesses; select a proportional pre-write Test Design Brief."
---

# Test Design

Use before creating or changing any repository-test artifact. Reading or running tests alone does not trigger this skill.

## Route

1. Keep the active workflow as driver.
2. Inspect the intended repository-test artifact change, approved seam, proof
   claim, existing regression, and focused command.
3. Select one route:
   - `no-new-brief`: no repository-test artifact changes and the active workflow
     owns the existing regression proof. Return immediately.
   - `lightweight`: the edit preserves the repository-approved seam, oracle
     contract, fixture meaning, harness behaviour, and claimed proof boundary,
     and reuses an existing focused regression.
   - `full`: any seam, oracle, fixture, harness, claim, CLI contract, or test
     contract is new, changed, disputed, or unclear.
4. Fail upward to `full` when the route is unclear.

## Evidence gates

- Use an executable focused command from a named working directory. Name the
  intended selector and expected non-zero test count. If no owner provides one,
  record that gap in a `full` brief.
- Treat an observed failing regression as RED evidence. Otherwise name a
  disposable perturbation that the selected test must catch, then return to the
  driver to restore GREEN in the same harness.

## Lightweight brief

Write this brief in the active conversation before editing:

```text
Lightweight Test Design Brief
Behaviour being corrected:
Existing test and focused command:
How the existing test goes RED:
Still unproved:
```

Then return to the current workflow. Escalate to `full` if implementation
reveals a changed seam, oracle, fixture, harness, or claim.

## Full brief

1. Read `references/pattern-library.md` completely.
2. Select every relevant profile, then read only the selected profile references completely.
3. Inspect the public behaviour, repository test conventions, and focused command.
4. Write this complete brief in the active conversation before editing:

```text
Test Design Brief
Behaviour:
Seam and proof layer:
Independent result:
How it goes RED:
Relevant profiles and gotchas:
Focused command:
Still unproved:
```

5. For an existing repository-approved or user-selected seam, return to the current workflow.
6. For a new, changed, or disputed seam, stop before mutation and ask the user to approve the seam.

Do not accept a brief whose expected result restates the implementation. Do not claim a broader boundary than the selected proof layer reaches.

## Driver handbacks

- `tdd`: brief before the first test edit; return for RED to GREEN.
- `diagnosing-bugs`: brief after reproduction and isolation; return before the regression-test edit.
- `ci-testbed`: use only when mismatch repair changes a repository-test artifact; return to its repair owner.
- `cli-author`: brief after contract and seam selection; return before test implementation.
- `test-runner`: use only when repair changes a repository-test artifact; return to repair mode.
- `improve-test-architecture`: brief after candidate selection; candidate
  selection does not approve a new, changed, or disputed seam; return to the
  selected improvement workflow.

## Done

- `no-new-brief` returned without emitting a brief only when no test artifact
  changes and the active workflow owns the existing regression proof.
- Selected brief visible and complete before the first repository-test artifact edit.
- A lightweight brief preserves its seam, oracle, fixture, harness, and claim.
- Seam already approved, already selected, or awaiting explicit approval.
- Handback to the active workflow explicit.
- Remaining unproved boundary stated without hiding skips, disabled cases, or environmental gaps.

Next safe action: return the completed brief to the current workflow.
