---
name: handoff
description: "Create a fresh-session handoff when the user asks to hand off work, continue elsewhere, or prepare the next session."
role: tool-workflow
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# Handoff

Create the handoff document only. When the user supplies an existing handoff
to continue, route to `resume-handoff`.

## Workflow

1. Resolve the current objective, repository root, branch, dirty state, and the
   next session's focus. Inspect them without changing git state.
2. Separate completed work from remaining work. Attach proof commands or
   receipts to completed claims.
3. Reference plans, issues, decisions, commits, diffs, and trackers by path or
   URL instead of copying them.
4. Record authority boundaries: actions already authorised, actions still
   requiring user approval, and destructive or external actions that remain
   out of scope.
5. Name blockers with one repair path each.
6. Name suggested skills as routes, not as permission to broaden the task.
7. End with the first safe action for `resume-handoff`.
8. Save the document in the operating system's temporary directory.

With no arguments, hand off the current active objective. Treat arguments as
the next session's narrower focus.

## Safety

- Redact secrets, tokens, passwords, cookies, auth-bearing URLs, and private
  payload values.
- Never claim a clean tree, passing check, commit, or external action without
  current evidence.

## Verification

- Read back the written handoff file.
- Verify it includes objective, repository and branch state, completed work and
  proof, remaining work, owner paths, authority boundaries, blockers, suggested
  skills, and first safe action.
- Verify sensitive values are redacted.
- Report the absolute handoff path.
