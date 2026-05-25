## Claude-Specific Notes

- **Skills** → `skills/name/SKILL.md` for anything needing reasoning, trigger specs, or references. `commands/*.md` for simple one-shot ops (regenerate, open, run). All skills user-invocable via `/name` by default. Add `disable-model-invocation: true` only to save context budget.
- **Obsidian** → `/para-brain:*` commands for vault content.
- **Newsroom** → When Nathan asks about community discussions/trends, invoke `/newsroom:investigate` immediately.
- **Claude Code docs** → `/claude-code-docs:help` (never `claude-code-guide` sub-agent).
- **Memory skills** → User-invocable memory skills under `~/.claude/skills/`.
- **Rules** → Auto-applied rules in `~/.claude/rules/` handle context7, tool-routing, newsroom triggers.
