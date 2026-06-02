@AGENTS.md

## Claude Runtime

- MCP output: pass `response_format: "json"` unless output goes directly to Nathan.
- Git/search/history reads: prefer MCP tools with JSON.

## Claude Context

- Load on-demand docs from `@~/.claude/context/<filename>.md`.
- Do targeted lookup, not bulk loading.

## Claude Notes

- Skills live under `~/.claude/skills/`.
- Rules under `~/.claude/rules/` auto-apply.
- Commands handle simple one-shot operations.
