---
alwaysApply: true
---

All MCP tools are machine-to-machine interfaces optimized for token efficiency. **ALWAYS use `response_format: "json"`** for structured, token-efficient responses. Never use `"markdown"` unless showing results directly to user.

- **Git reads** → Use MCP tools with JSON format
- **Git writes** → Use bash or `/git:*` slash commands
- **Search** → Use Kit plugin with JSON format
- **Tests/Lint/Type Check** → Use runner MCP tools (bun, biome, tsc), never Bash
- **History** → Use Atuin MCP with JSON format
- **Package execution** → Prefer `bunx` over `npx` (faster, more reliable)
