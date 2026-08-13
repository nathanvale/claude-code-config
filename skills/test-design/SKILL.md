---
name: test-design
description: "Creating or changing tests, fixtures, mocks, snapshots, test helpers, or test harnesses; require a pre-write Test Design Brief."
---

# Test Design

Use before creating or changing any repository-test artifact. Reading or running tests alone does not trigger this skill.

## Workflow

1. Keep the active workflow as driver.
2. Read `references/pattern-library.md` completely.
3. Select every relevant profile, then read only the selected profile references completely.
4. Inspect the public behaviour, repository test conventions, and focused command.
5. Write this complete brief in the active conversation before editing:

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

6. For an existing repository-approved or user-selected seam, return to the current workflow.
7. For a new, changed, or disputed seam, stop before mutation and ask the user to approve the seam.

Do not accept a brief whose expected result restates the implementation. Do not claim a broader boundary than the selected proof layer reaches.

## Driver handbacks

- `tdd`: brief before the first test edit; return for RED to GREEN.
- `diagnosing-bugs`: brief after reproduction and isolation; return before the regression-test edit.
- `ci-testbed`: use only when mismatch repair changes a repository-test artifact; return to its repair owner.
- `cli-author`: brief after contract and seam selection; return before test implementation.
- `test-runner`: use only when repair changes a repository-test artifact; return to repair mode.
- `improve-test-architecture`: brief after Nathan selects a candidate; return to the selected improvement workflow.

## Done

- Brief visible and complete before the first repository-test artifact edit.
- Seam already approved, already selected, or awaiting explicit approval.
- Handback to the active workflow explicit.
- Remaining unproved boundary stated without hiding skips, disabled cases, or environmental gaps.

Next safe action: return the completed brief to the current workflow.
