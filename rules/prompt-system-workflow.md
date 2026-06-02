---
alwaysApply: true
---

When Nathan asks to add, change, move, or remove startup instructions, rules, context files, or harness-specific behavior, invoke `/prompt-system-workflow` via the Skill tool immediately. The skill handles classification, routing, health checks, and verification.

**Trigger phrases:**
- "Add a rule for X"
- "Add a context file for X"
- "Move this to shared / Claude-only / Codex-only"
- "Change the startup prompt"
- "Add harness support for X"
- Any mention of editing `AGENTS.md`, `CLAUDE.md`, `rules/`, or `context/` for startup-instruction purposes

**Do NOT** manually route startup-instruction changes by guessing placement — the workflow reads the ADR, router skill, and health contract.
