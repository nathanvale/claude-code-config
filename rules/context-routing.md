---
alwaysApply: true
---

## Context Routing

When writing or routing information, follow these rules:

- **CLAUDE.md** is session-start context only. Never dump durable facts here.
- **context/** is for compact durable recall: people, glossary, project summaries, preferences, and reusable context.
- **docs/** is for full authored documents: research, plans, specs, decisions, and logs.
- **Repos own their own truth.** Write durable context and docs to the owning repo, not to `my-second-brain`.
- **my-second-brain** is the life vault — only for cross-project synthesis, personal durable knowledge, and concerns not owned by a specific repo.
- Promote to CLAUDE.md only when the information is needed in most sessions.
- When unsure which repo owns something, ask — don't default to the current repo.
- Storage routing owner: `skills/context-advisor/SKILL.md`.
- Stable user context path: `~/.config/context`.
