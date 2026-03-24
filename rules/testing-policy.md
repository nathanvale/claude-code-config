---
alwaysApply: true
---

## Testing Policy

- Always run tests after code changes
- If no tests exist for changed code, ask if tests should be added
- Never delete or skip a failing test to make CI pass
- Never mock something you can test against directly
- Reproduce bugs with a failing test before fixing the code

Bad: deleting a failing test to unblock CI
Good: fixing the root cause, or marking as `test.skip('reason — ISSUE-123')`
