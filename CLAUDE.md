<!-- GENERATED — do not edit directly. Edit prompt-fragments/ and run: scripts/render-user-prompts.sh --write -->
@AGENTS.md

## Claude Tool Preferences

**IMPORTANT:** All MCP tools are machine-to-machine interfaces optimized for token efficiency. **ALWAYS use `response_format: "json"`** for structured, token-efficient responses. Never use `"markdown"` unless showing results directly to user.

- **Git reads** → Use MCP tools with JSON format
- **Git writes** → Use bash or git slash commands
- **Search** → Use Kit plugin with JSON format
- **History** → Use Atuin MCP with JSON format

## Claude Context Loading

When you need one of the on-demand context docs, load it from the Claude user-scope context surface with:

- `@~/.claude/context/<filename>.md`

Use this for targeted lookup, not bulk loading.

## Claude-Specific Notes

- **Skills** → Use `skills/name/SKILL.md` for anything that needs reasoning, trigger specs, or references. Use `commands/*.md` for simple one-shot operations (regenerate, open, run). All skills are user-invocable with `/name` by default. Add `disable-model-invocation: true` only to save context budget.
- **Obsidian** → Use `/para-brain:*` commands for vault content
- **Newsroom** → When Nathan asks about community discussions/trends, invoke `/newsroom:investigate` immediately
- **Claude Code docs** → Use `/claude-code-docs:help` (never `claude-code-guide` sub-agent)
- **Memory skills** → User-invocable memory skills live under `~/.claude/skills/`
- **Rules** → Auto-applied rules in `~/.claude/rules/` handle context7, tool-routing, and newsroom triggers

