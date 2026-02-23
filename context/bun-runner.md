# Bun Runner (MCP Tools)

## Why MCP Over CLI

MCP tools filter output → token-efficient, failures only

## Testing

| Tool | Use |
|------|-----|
| `bun_runTests` | All tests or filter by pattern |
| `bun_testFile` | Specific file |
| `bun_testCoverage` | Coverage summary |

## Linting

| Tool | Use |
|------|-----|
| `bun_lintCheck` | Check issues (read-only) |
| `bun_lintFix` | Auto-fix (`--write`) |
| `bun_formatCheck` | Formatting only |

## Hooks (Automatic)

- **PostToolUse** → Biome fix + tsc check after Write/Edit
- **Stop** → Full lint + type check before session ends

Exit codes → 0 = success, 2 = blocking error
