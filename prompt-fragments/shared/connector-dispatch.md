## Connector Dispatch

When Nathan asks about calendar events, email, or contacts, use the productivity connector system — not built-in MCP tools.

1. Read `.productivity.yml` in current project root for connector and account.
2. Read `productivity-connectors` skill for routing table and dispatch protocol.
3. Dispatch via Bash CLI (e.g., `gog` with `--account <email> --json`) or MCP tool as routing table specifies.
4. If `.productivity.yml` doesn't exist, ask which account to use.

Do not call `gcal_list_events`, `gcal_get_event`, `gmail_search_messages`, or other Google MCP tools directly.
