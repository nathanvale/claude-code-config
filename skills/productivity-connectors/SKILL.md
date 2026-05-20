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
  calendar-client:             # optional when calendar is gog — gogcli client name (e.g., monash, personal). Defaults to "default" if unset.
  email: gmail                 # gmail | gog | microsoft-365 | none
  email-account:               # required when email is gog (e.g., hi@nathanvale.com)
  email-client:                # optional when email is gog — gogcli client name
  contacts: gog                # gog | none
  contacts-account:            # required when contacts is gog
  contacts-client:             # optional when contacts is gog — gogcli client name
  sheets: gog                  # gog | none
  sheets-account:              # required when sheets is gog
  sheets-client:               # optional when sheets is gog — gogcli client name
  drive: gog                   # gog | none
  drive-account:               # required when drive is gog
  drive-client:                # optional when drive is gog — gogcli client name
  project-tracker: jira        # jira | asana | linear | github-issues | monday | clickup | none
  knowledge-base: confluence   # notion | confluence | none
  chat: none                   # slack | none
  messages: imessage           # imessage | none
```

**Client routing:** `<connector>-client` pins each gog call to a named OAuth client registered with `gog auth credentials set <json> --client <name>`. This is how two repos with different Google identities (e.g., `monash-smst` + `my-second-brain`) can run gog commands simultaneously in different terminals without stomping each other's refresh tokens. If `<connector>-client` is omitted, gog uses its built-in `default` client. Always set it when the repo is paired with a specific Google identity that differs from the machine's global default.

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
4. Read `<connector>-client` from `.productivity.yml` (e.g., `calendar-client`, `email-client`)
5. If `<connector>-client` is present, pass `--client <name>` on every `gog` command. If absent, do **not** pass `--client` at all (gog will use its built-in default).
6. Never invent a client name. If the repo's identity mismatches the available gog clients (`gog auth credentials list`), stop with: "`<connector>-client: <name>` not registered — run `gog auth credentials set <json> --client <name>` first"

## Calendar

| Connector | Tools |
|-----------|-------|
| `google-calendar` | `gcal_list_events`, `gcal_get_event`, `gcal_list_calendars`, `gcal_find_my_free_time` |
| `microsoft-365` | Microsoft Graph calendar tools |
| `gog` | `gog calendar events --account <email> --client <name> --from today --days 3 --json` (via Bash — see references/gogcli-commands.md) |

**Common patterns:**
- Past 2 days + next 3 days for default sync
- Full week scan for `--deep` mode
- Extract attendees for memory cross-referencing

## Email

| Connector | Tools |
|-----------|-------|
| `gmail` | `gmail_search_messages`, `gmail_read_message`, `gmail_read_thread`, `gmail_list_labels` |
| `microsoft-365` | Microsoft Graph mail tools |
| `gog` | `gog gmail search "is:unread" --account <email> --client <name> --json --max 20` (via Bash — see references/gogcli-commands.md) |

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
| `confluence` | `mcp__mcp-atlassian__confluence_search`, `mcp__mcp-atlassian__confluence_get_page` |

**Common patterns:**
- Recently modified docs for `--deep` mode
- Project documentation and page lookup
- Do NOT use this connector for meeting transcriptions — see `transcriptions:` below

## Transcriptions

Optional. Declares where meeting transcripts live when it differs from the knowledge base.
Most projects where Zoom auto-transcribes into Notion need this split.

```yaml
transcriptions: notion                                           # notion | confluence | none
transcriptions-db: collection://190a3712-3878-8141-9c9d-000b7c4c72a2  # Notion collection ID for Meetings DB
```

| Connector | Tools |
|-----------|-------|
| `notion` | `mcp__notion__notion-search` (find) + `mcp__notion__notion-fetch` with `include_transcript: true` (retrieve raw) |
| `confluence` | `mcp__mcp-atlassian__confluence_search` + `mcp__mcp-atlassian__confluence_get_page` |

**Critical rules:**
- Always fetch with `include_transcript: true` — this returns the raw Zoom transcript
- **Never use the Notion AI `<summary>` block** — it is generated and unreliable. The raw `<transcript>` block is the authoritative source
- If `transcriptions-db:` is set, scope the search to that collection ID — prevents pulling transcripts from other teams in the same Notion workspace
- Filter by `created_date_range` matching the sync window to avoid reprocessing old transcripts

## Chat

| Connector | Tools |
|-----------|-------|
| `slack` | Slack MCP tools |

**Note:** Chat scanning is `--deep` mode only. Not included in default sync due to volume.

## Messages

| Connector | Primary (MCP) | Fallback (CLI) |
|-----------|---------------|----------------|
| `imessage` | `sync_archive`, `search_messages`, `list_contacts`, `list_threads`, `reply` | `bun run ~/.claude/skills/imessage-reader/scripts/query-imessage.ts` |

**MCP tool routing (preferred — use when `plugin:imessage` tools are available):**

- **Default sync:** `sync_archive(save_dir: "~/code/personal-messages")`
  - Cursor-based incremental sync with 1-hour overlap safety
  - Persists markdown + manifest + cursor automatically to `{save_dir}/docs/messages/imessage/`
  - Returns `commitment_candidates` directly in the response
- **Deep sync (7-day):** `sync_archive(save_dir: "~/code/personal-messages", since: "<7-days-ago-ISO>")`
- **Outbound commitments:** `search_messages(from_me: true, since: "<date>", save: true, save_dir: "~/code/personal-messages")`
  - Returns `commitment_candidates` for outbound promises
- **Ad-hoc search:** `search_messages(search: "<query>", since: "<date>")`
  - Optionally persist with `save: true, save_dir: "~/code/personal-messages"`
- **Reply:** `reply(chat_id: "<chat_id>", text: "<message>")`
  - Allowlisted chats only — use to act on commitments surfaced during sync
- **Contacts:** `list_contacts()` / **Threads:** `list_threads()`

**CLI fallback (use when MCP tools are unavailable):**
- Default sync: `bun run ~/.claude/skills/imessage-reader/scripts/query-imessage.ts sync --save-dir ~/code/personal-messages/docs/messages/imessage/`
- Deep sync: `sync --since <7-days-ago> --save-dir ~/code/personal-messages/docs/messages/imessage/`
- Read-through query: `messages --since <date> --search <term>`
- `enrich` and `migrate-notes` commands are CLI-only (no MCP equivalent)

**Notes:**
- Commitment extraction runs inline — no post-processing needed
- Cursor file is shared between MCP and CLI — no drift when alternating
- Privacy-sensitive: see `~/code/personal-messages/docs/specs/privacy-and-retention.md`

## Contacts

| Connector | Tools |
|-----------|-------|
| `gog` | `gog contacts list --account <email> --client <name> --json` or `gog contacts search "<query>" --account <email> --client <name> --json` (via Bash — see references/gogcli-commands.md) |

**Common patterns:**
- Search by name for people cross-referencing
- Retrieve contact details for meeting attendees

## Sheets

| Connector | Tools |
|-----------|-------|
| `gog` | `gog sheets get <spreadsheetId> <range> --account <email> --client <name> --json` (read) • `gog sheets update <spreadsheetId> <range> <values> --account <email> --client <name>` (write) • `gog sheets append <spreadsheetId> <range> <values> --account <email> --client <name>` (append) (via Bash — see references/gogcli-commands.md) |

**Common patterns:**
- Read a range for review loops (e.g., reconciliation CSVs round-tripped via Sheets)
- Append rows for batch logging
- Use `--json` for structured reads, plain text for simple writes
- Always pass the spreadsheet ID and A1 range explicitly — no implicit "active sheet"

## Drive

| Connector | Tools |
|-----------|-------|
| `gog` | `gog drive ls --account <email> --client <name> --json` (list) • `gog drive search "<query>" --account <email> --client <name> --json` (search) • `gog drive download <fileId> --account <email> --client <name>` (download) • `gog drive upload <localPath> --account <email> --client <name>` (upload) (via Bash — see references/gogcli-commands.md) |

**Common patterns:**
- Search by name/content to resolve a file before acting on it (never guess file IDs)
- Download Google Docs/Sheets with export format flags
- Upload local artifacts (CSVs, reports) into a known folder
- Use `gog drive get <fileId>` for metadata before destructive ops

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
Omitting `--account` from a `gog` command (gmail, calendar, contacts, **sheets**, **drive**, etc.) returns exit 0 with data from the **wrong account** (whichever account gogcli defaults to). This is the hardest failure mode — it looks like success. **Always** pass `--account <email>` explicitly. The dispatch protocol above enforces a pre-dispatch assertion: if `<connector>-account` is missing from `.productivity.yml`, stop before running any `gog` command.

### Wrong OAuth client (unauthorized_client error)
Each account's refresh token is bound to the OAuth client_id under which it was issued (`gog auth add <email> --client <name>`). If you run a gog command for that account under a different `--client` — or omit `--client` when the account was authed under a named client — the refresh request presents a mismatched client_id and Google returns `oauth2: "unauthorized_client" "Unauthorized"`. Fix: use the same `--client` name that was used for `gog auth add`. The `.productivity.yml` `<connector>-client` field pins each repo to its correct client so `/productivity-sync` never picks the wrong one.

### gog auth list --check shows stale data
`gog auth list --check` in gogcli v0.12.0 does not honor `--client` and sometimes reports old token state even after a successful `gog auth add`. Do not trust it as ground truth. For real verification, run an actual API call: `gog calendar calendars --account <email> --client <name> -j --results-only | head`. If it returns JSON, the token works. If it returns `unauthorized_client`, the token is stale or bound to a different client.

### Multi-client multi-terminal safety
Two terminals in two different repos (e.g., `monash-smst` with `calendar-client: monash` and `my-second-brain` with `calendar-client: personal`) can run gog commands concurrently without conflict — each client has a separate credentials file (`~/.config/gogcli/credentials-<name>.json`) and the refresh tokens for different accounts don't collide in Keychain. The only thing you **cannot** do is run two terminals both trying to re-auth the *same* account at the same time (Keychain write race). For normal read operations, parallelism is safe.

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

### 2. Pre-dispatch account + client assertion (gog only)
Before any `gog` command, verify the account and client are configured:
- Read `<connector>-account` from `.productivity.yml` (e.g., `calendar-account`, `email-account`)
- If missing: stop with "`<connector>-account` not set in `.productivity.yml` — cannot dispatch gog safely"
- If present: pass as `--account <email>` on the command
- Read `<connector>-client` from `.productivity.yml` (e.g., `calendar-client`, `email-client`)
- If present: pass as `--client <name>` on the command
- If absent: do not pass `--client` (gog uses its built-in default)
- Never invent a client name. If the value in `.productivity.yml` doesn't appear in `gog auth credentials list`, stop and tell the user: "`<connector>-client: <name>` not registered — run `gog auth credentials set <json> --client <name>` first"

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
