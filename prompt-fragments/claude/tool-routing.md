## Claude Tool Preferences

All MCP tools are machine-to-machine. **Always pass `response_format: "json"`** for token-efficient responses. Use `"markdown"` only when output goes directly to the user.

- **Git reads** → MCP tools with JSON format.
- **Git writes** → bash or git slash commands.
- **Search** → Kit plugin with JSON format.
- **History** → Atuin MCP with JSON format.
