<!-- GENERATED — do not edit directly. Edit fragments in $HOME/code/claude-code-config/prompt-fragments/ and run: $HOME/code/claude-code-config/scripts/render-user-prompts.sh --write -->
@AGENTS.md

## Claude Tool Preferences

All MCP tools are machine-to-machine. **Always pass `response_format: "json"`** for token-efficient responses. Use `"markdown"` only when output goes directly to the user.

- **Git reads** → MCP tools with JSON format.
- **Git writes** → bash or git slash commands.
- **Search** → Kit plugin with JSON format.
- **History** → Atuin MCP with JSON format.

## Claude Context Loading

Load on-demand context docs from the Claude user-scope context surface:

- `@~/.claude/context/<filename>.md`

For targeted lookup, not bulk loading.

## Claude-Specific Notes

- **Skills** → `skills/name/SKILL.md` for anything needing reasoning, trigger specs, or references. `commands/*.md` for simple one-shot ops (regenerate, open, run). All skills user-invocable via `/name` by default. Add `disable-model-invocation: true` only to save context budget.
- **Obsidian** → `/para-brain:*` commands for vault content.
- **Newsroom** → When Nathan asks about community discussions/trends, invoke `/newsroom:investigate` immediately.
- **Claude Code docs** → `/claude-code-docs:help` (never `claude-code-guide` sub-agent).
- **Memory skills** → User-invocable memory skills under `~/.claude/skills/`.
- **Rules** → Auto-applied rules in `~/.claude/rules/` handle context7, tool-routing, newsroom triggers.

