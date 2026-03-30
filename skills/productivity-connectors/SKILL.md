---
name: productivity-connectors
description: Use when selecting which tool or bash command to invoke for calendar, email, project tracker, knowledge base, chat, or messages operations. Read before dispatching any connector call. Lists MCP and Bash-backed connectors with per-project config via .productivity.yml.
user-invocable: false
---

# Connectors

Tool routing table for external data sources. Reference this skill when you need to know which MCP tools to call for calendar, email, project tracking, knowledge base, or chat operations.

## Per-Project Config

Each project can declare which connectors are active in `.productivity.yml`:

```yaml
# Productivity connector config for this project
connectors:
  calendar: google-calendar    # google-calendar | gog | microsoft-365 | none
  calendar-account:            # required when calendar is gog (e.g., nathan.vale@monash.edu)
  email: gmail                 # gmail | gog | microsoft-365 | none
  email-account:               # required when email is gog (e.g., hi@nathanvale.com)
  project-tracker: jira        # jira | asana | linear | github-issues | monday | clickup | none
  knowledge-base: confluence   # notion | confluence | none
  chat: none                   # slack | none
  messages: imessage           # imessage | none
```

**How to use this config:**
1. Read `.productivity.yml` to determine which connectors are active
2. Map the connector value to the tool table below
3. If a declared connector's MCP tool isn't available in the session, skip with a note
4. If `.productivity.yml` doesn't exist, tell the user to run `/productivity-setup` first

**Bash connector dispatch protocol:**
When a connector is Bash-backed (e.g., `gog`, `github-issues`, `imessage`), read the connector-specific fields from `.productivity.yml` before dispatching. For `gog` connectors specifically:
1. Read `<connector>-account` from `.productivity.yml` (e.g., `calendar-account`, `email-account`)
2. If `<connector>-account` is missing, **stop with an error** — do not dispatch without `--account`. Say: "`<connector>-account` not set in `.productivity.yml` — cannot dispatch gog safely"
3. Pass the account as `--account <email>` on every `gog` command

## Calendar

| Connector | Tools |
|-----------|-------|
| `google-calendar` | `gcal_list_events`, `gcal_get_event`, `gcal_list_calendars`, `gcal_find_my_free_time` |
| `microsoft-365` | Microsoft Graph calendar tools |
| `gog` | `gog calendar events --account <email> --from today --days 3 --json` (via Bash — see references/gogcli-commands.md) |

**Common patterns:**
- Past 2 days + next 3 days for default sync
- Full week scan for `--deep` mode
- Extract attendees for memory cross-referencing

## Email

| Connector | Tools |
|-----------|-------|
| `gmail` | `gmail_search_messages`, `gmail_read_message`, `gmail_read_thread`, `gmail_list_labels` |
| `microsoft-365` | Microsoft Graph mail tools |
| `gog` | `gog gmail search "is:unread" --account <email> --json --max 20` (via Bash — see references/gogcli-commands.md) |

**Common patterns:**
- Unread inbox for default sync
- Sent messages for `--deep` mode (find commitments made)
- Search by sender/recipient for people context

## Project Trackers

| Connector | Tools |
|-----------|-------|
| `jira` | `searchJiraIssuesUsingJql`, `getJiraIssue`, `getVisibleJiraProjects` |
| `asana` | Asana MCP tools |
| `linear` | Linear MCP tools |
| `github-issues` | `gh issue list --assignee=@me` (via Bash) |
| `monday` | Monday.com MCP tools |
| `clickup` | ClickUp MCP tools |

**Common patterns:**
- Open/in-progress issues assigned to user
- Compare against TASKS.md for sync
- Flag items completed externally

## Knowledge Base

| Connector | Tools |
|-----------|-------|
| `notion` | `notion-search`, `notion-fetch`, `notion-query-database-view` |
| `confluence` | `searchConfluenceUsingCql`, `getConfluencePage` |

**Common patterns:**
- Meeting transcription search and retrieval for meeting notes sync
- Recently modified docs for `--deep` mode
- Project documentation lookup

## Chat

| Connector | Tools |
|-----------|-------|
| `slack` | Slack MCP tools |

**Note:** Chat scanning is `--deep` mode only. Not included in default sync due to volume.

## Messages

| Connector | Tools |
|-----------|-------|
| `imessage` | Local CLI: `bun run ~/.claude/skills/imessage-reader/scripts/query-imessage.ts` |

**Common patterns:**
- Default sync: `sync --save-dir ~/code/personal-messages/docs/messages/imessage/`
- Deep sync: `sync --since <7-days-ago> --save-dir ~/code/personal-messages/docs/messages/imessage/`
- Read-through query: `messages --since <date> --search <term>`
- Commitment extraction runs after sync, renders `CommitmentCandidate[]` for triage
- Privacy-sensitive: see `~/code/personal-messages/docs/specs/privacy-and-retention.md`

## Contacts

| Connector | Tools |
|-----------|-------|
| `gog` | `gog contacts list --account <email> --json` or `gog contacts search "<query>" --account <email> --json` (via Bash — see references/gogcli-commands.md) |

**Common patterns:**
- Search by name for people cross-referencing
- Retrieve contact details for meeting attendees

## Availability Check Pattern

Before calling any tool above, verify it exists:

```
1. Read .productivity.yml for the declared connector
2. Map to the tool name from the table above
3. Attempt the call
4. If tool is unavailable, skip with: "Skipped [source] -- [connector] tools not connected"
5. Continue to next source
```

Never fail the entire sync because one source is unavailable.

## Gotchas

### Wrong account (silent failure)
Omitting `--account` from a `gog` command returns exit 0 with data from the **wrong account** (whichever account gogcli defaults to). This is the hardest failure mode — it looks like success. **Always** pass `--account <email>` explicitly. The dispatch protocol above enforces a pre-dispatch assertion: if `<connector>-account` is missing from `.productivity.yml`, stop before running any `gog` command.

### Keyring access on headless/SSH
On Mac Mini via SSH, gogcli cannot access the macOS keychain. Set `GOG_KEYRING_BACKEND=file` before running gog commands. See gogcli Issue #206.

### JSON output shape differs from MCP
`gog` returns its own JSON structure, not the same shape as MCP tool responses (e.g., `gcal_list_events`). Parse gogcli JSON directly — do not assume field names match MCP equivalents.

### Date flag constraints
`--from` and `--to` accept ISO dates (`2026-03-28`) and named days (`today`, `tomorrow`) but **NOT** relative arithmetic (`+3d`, `-2d`). For past windows, compute the ISO date at dispatch time: `$(date -v-2d +%Y-%m-%d)`. Use `--days=N` for forward windows.

## Bash Connector Check Pattern

For Bash-backed connectors (`gog`, `github-issues`, `imessage`), verify availability before dispatching:

### 1. Binary check
```bash
which gog >/dev/null 2>&1 || { echo "gog not found — install gogcli first"; exit 1; }
```

### 2. Pre-dispatch account assertion (gog only)
Before any `gog` command, verify the account is configured:
- Read `<connector>-account` from `.productivity.yml` (e.g., `calendar-account`, `email-account`)
- If missing: stop with "`<connector>-account` not set in `.productivity.yml` — cannot dispatch gog safely"
- If present: pass as `--account <email>` on the command

### 3. Exit code handling
| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | Success | Parse JSON output |
| Non-zero | Error | Read stderr, skip with: "Skipped [source] — gog error for [account]: [stderr summary]" |

### 4. Auth error recovery
If stderr mentions token expiry or auth failure:
- Skip the current source with a clear message
- Suggest: "Re-run `gog auth add <email>` to refresh credentials"
- Continue to next source — never fail the entire sync for one connector

### 5. Wrong-account detection
Exit 0 with wrong data is undetectable at the CLI level. Prevention is the only strategy:
- Always use `--account <email>` (enforced by the dispatch protocol)
- Never rely on gogcli's default account selection
