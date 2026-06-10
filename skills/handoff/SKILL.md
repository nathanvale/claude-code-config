---
name: handoff
description: "Use when the current session needs to hand off work to another agent or a fresh session. Compacts the current conversation into a handoff document for the next agent to pick up."
role: tool-workflow
argument-hint: "What will the next session be used for?"
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section with skills for the next agent to invoke.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

## Verification

- Read back the written handoff file.
- Verify it includes current objective, completed work, remaining work, relevant paths, blockers, and suggested skills.
- Verify sensitive values are redacted.
- Report the absolute handoff path.
