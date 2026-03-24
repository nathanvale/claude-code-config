---
alwaysApply: true
---

## Memory OS Governance

When writing or routing information, follow these rules:

- **CLAUDE.md** is hot memory only — broadly relevant, high-frequency cues. Never dump durable facts here.
- **memory/** is for compact durable recall — people, glossary, project summaries, preferences, context.
- **docs/** is for full authored documents — research, plans, specs, decisions, logs.
- **Repos own their own truth.** Write memory and docs to the owning repo, not to `my-second-brain`.
- **my-second-brain** is the life vault — only for cross-project synthesis, personal durable knowledge, and concerns not owned by a specific repo.
- Promote to CLAUDE.md only when the information is needed in most sessions.
- When unsure which repo owns something, ask — don't default to the current repo.
- Full contract at `~/.config/memory/AGENTS.md` and `~/.config/memory/docs/memory-os-contract.md`.
