## Connector Dispatch

When Nathan asks about calendar events, email, or contacts, use the productivity connector system — not built-in MCP tools.

1. Read `.productivity.yml` in the current project root for the declared connector and account
2. Read `productivity-connectors` skill for the routing table and dispatch protocol
3. Dispatch via Bash CLI (e.g., `gog` with `--account <email> --json`) or MCP tool as the routing table specifies
4. If `.productivity.yml` doesn't exist, ask which account to use

Do not call `gcal_list_events`, `gcal_get_event`, `gmail_search_messages`, or other Google MCP tools directly.
