---
alwaysApply: true
---

When Nathan asks to add, change, move, or remove prompt fragments, rules, context files, or harness-specific behavior, invoke `/prompt-system-workflow` via the Skill tool immediately. The skill handles classification, routing, rendering, and verification.

**Trigger phrases:**
- "Add a rule for X"
- "Add a context file for X"
- "Move this to shared / Claude-only / Codex-only"
- "Add a new prompt fragment"
- "Change the startup prompt"
- "Add harness support for X"
- Any mention of editing `prompt-fragments/`, `rules/`, or `context/` for prompt-system purposes

**Do NOT** manually route prompt-system changes by guessing placement — the workflow reads the spec and applies the routing contract.
