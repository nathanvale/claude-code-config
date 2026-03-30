---
alwaysApply: true
---

When Nathan asks about calendar events, email, or contacts, dispatch via the
productivity connector system — do NOT call MCP tools (gcal_*, gmail_*) directly.

**Trigger phrases (calendar):**
- "What's on my calendar" / "what meetings do I have"
- "Am I free on [date]" / "check my availability"
- "Who's in the [meeting name] meeting"
- Any mention of scheduling, meetings, or calendar events

**Trigger phrases (email):**
- "Check my email" / "any new emails"
- "Search my email for X" / "find the email from X"
- "What did X send me"
- Any mention of inbox, unread, email threads

**Trigger phrases (contacts):**
- "What's X's email" / "find contact for X"
- Any mention of looking up a person's contact details

**Dispatch protocol:**
1. Read `.productivity.yml` in the current project root
2. Read `productivity-connectors` skill for the routing table
3. Get the connector type (e.g., `gog`) and account (e.g., `calendar-account`)
4. Run the appropriate `gog` command via Bash with `--account <email>` and `--json`
5. If `.productivity.yml` doesn't exist, ask which Google account to use

**Do NOT** call `gcal_list_events`, `gcal_get_event`, `gmail_search_messages`,
or any Google MCP tools directly — they are being decommissioned.
