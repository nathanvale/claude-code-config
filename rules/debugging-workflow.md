---
alwaysApply: true
---

## Debugging Workflow

When a test, build, or command fails:

1. Read the full error output before acting
2. Trace to the root cause — don't retry the same command hoping for a different result
3. If blocked after 2 attempts with different approaches, stop and explain what you've tried
4. Never suppress or swallow errors to make something "pass"
5. Never add `try/catch` or `|| true` to hide a failure you don't understand

Bad: retrying `bun test` 3 times hoping the flake resolves itself
Good: reading the stack trace, finding the failing assertion, fixing the source
