## Claude-Specific Notes

- **Skills** → Use `skills/name/SKILL.md` for anything that needs reasoning, trigger specs, or references. Use `commands/*.md` for simple one-shot operations (regenerate, open, run). All skills are user-invocable with `/name` by default. Add `disable-model-invocation: true` only to save context budget.
- **Obsidian** → Use `/para-brain:*` commands for vault content
- **Newsroom** → When Nathan asks about community discussions/trends, invoke `/newsroom:investigate` immediately
- **Claude Code docs** → Use `/claude-code-docs:help` (never `claude-code-guide` sub-agent)
- **Memory skills** → User-invocable memory skills live under `~/.claude/skills/`
- **Rules** → Auto-applied rules in `~/.claude/rules/` handle context7, tool-routing, and newsroom triggers
