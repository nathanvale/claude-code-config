# Atuin (Shell History)

## MCP Tools

| Tool | Use |
|------|-----|
| `atuin_search_history` | Fuzzy/prefix search with filters |
| `atuin_get_recent_history` | N most recent commands |
| `atuin_search_by_context` | Filter by git branch or session |
| `atuin_history_insights` | Frequent commands, failures |

## Auto-Capture

PostToolUse hook captures all Bash commands with:
- Command text + exit code
- Git branch context
- Claude session ID

Fallback → `fc -l | grep [query]`
