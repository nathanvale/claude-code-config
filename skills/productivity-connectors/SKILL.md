---
name: productivity-connectors
description: "Route productivity tools from .productivity.yml; use gog for Google services with explicit account and OAuth client selection."
role: support-reference
user-invocable: false
---

# Connectors

Tool routing table for external data sources. Reference this skill when you need to know which MCP tools to call for calendar, email, project tracking, knowledge base, or chat operations.

## Owner

- Connector routing and dispatch safety: this file.
- Exact `gog` commands, flags, pagination, auth checks, and date constraints: `skills/productivity-connectors/references/gogcli-commands.md`.
- iMessage CLI fallback contracts: `skills/imessage-reader/SKILL.md` and `skills/imessage-reader/scripts/query-imessage.ts`.
- Project connector config shape: `.productivity.yml` in the owning repo.

## Per-Project Config

Each project can declare which connectors are active in `.productivity.yml`:

```yaml
# Productivity connector config for this project
connectors:
  calendar: gog               # gog | microsoft-365 | none
  calendar-account:            # required when calendar is gog (e.g., nathan.vale@monash.edu)
  calendar-client:             # optional when calendar is gog — gogcli client name (e.g., monash, personal). Defaults to "default" if unset.
  email: gog                  # gog | microsoft-365 | none
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

**Client routing:** `<connector>-client` pins each gog call to a named OAuth client registered with `gog --client <name> auth credentials set <json>`. This is how two repos with different Google identities (e.g., `monash-smst` + `my-second-brain`) can run gog commands simultaneously in different terminals without stomping each other's refresh tokens. If `<connector>-client` is omitted, gog resolves the client from its account/domain mappings, then falls back to `default`. Set it when the repository needs a deterministic client rather than gog's machine-local resolution.

**Resolution order:**
1. Read the nearest `.productivity.yml` before inspecting tools or inferring identity.
2. Use its `<connector>-account` and `<connector>-client` pair when present.
3. Validate that exact pair. With a named client, run
   `gog --client <name> auth list --json --no-input`; otherwise omit
   `--client` and validate against the default client.
4. If `.productivity.yml` exists but `<connector>-account` is absent, stop.
   Never infer a configured repository's Google identity from context.
5. If `.productivity.yml` is absent, require an explicit account for ad-hoc
   reads. Use a named client only when the user supplies it or the account does
   not resolve in the default client.
6. In the ad-hoc route, confirm the explicit account before every write.

Unattended sync remains blocked until the project pins its routing.

**Bash connector dispatch protocol:**
When a connector is Bash-backed (e.g., `gog`, `github-issues`, `imessage`), read the connector-specific fields from `.productivity.yml` before dispatching. For `gog` connectors specifically:
1. Read `<connector>-account` from `.productivity.yml` (e.g., `calendar-account`, `email-account`)
2. If `.productivity.yml` exists and `<connector>-account` is missing, **stop
   with an error** — do not dispatch. Say: "`<connector>-account` not set in
   `.productivity.yml` — cannot dispatch gog safely"
3. If `.productivity.yml` is absent, use only the explicit ad-hoc identity from
   the resolution order. Never infer an account from project/task context.
4. Pass the account as `--account <email>` on every `gog` command.
5. Read `<connector>-client` from `.productivity.yml` or the explicit ad-hoc
   identity.
6. If `<connector>-client` is present, pass `--client <name>` on preflight and
   every `gog` command. If absent, omit `--client` everywhere.
7. Put global flags before the service command. Agent reads include
   `--readonly --no-input --wrap-untrusted --json`. Writes omit `--readonly`,
   retain `--no-input --wrap-untrusted --json`, and follow the confirmation
   rule above.
8. Never invent a client name. If the repo's identity mismatches the available
   gog clients (`gog auth credentials list`), stop with:
   "`<connector>-client: <name>` not registered — run
   `gog --client <name> auth credentials set <json>` first".

## Calendar

| Connector | Tools |
|-----------|-------|
| `microsoft-365` | Microsoft Graph calendar tools |
| `gog` | Bash via `gog`; see `references/gogcli-commands.md` |

**Common patterns:**
- Past 2 days + next 3 days for default sync
- Full week scan for `--deep` mode
- Extract attendees for memory cross-referencing

## Email

| Connector | Tools |
|-----------|-------|
| `microsoft-365` | Microsoft Graph mail tools |
| `gog` | Bash via `gog`; see `references/gogcli-commands.md` |

**Body-reading invariant:** When surfacing email during sync or triage, read the full body before presenting results. Extract products, amounts, actions, and dates. Never ask Nathan what an accessible email says. Decode base64 HTML bodies and parse the content before summarising.

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
| `notion` | `mcp__notion__notion-search`, `mcp__notion__notion-fetch`, `mcp__notion__notion-query-database-view` |
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

**Note:** Default sync when configured (24h window). Expanded to 7d in `--deep` mode.

## Messages

| Connector | Primary (MCP) | Fallback (CLI) |
|-----------|---------------|----------------|
| `imessage` | `sync_archive`, `search_messages`, `list_contacts`, `list_threads`, `reply` | `bun run skills/imessage-reader/scripts/query-imessage.ts` |

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
- Use `skills/imessage-reader/SKILL.md` for routing.
- Use `skills/imessage-reader/scripts/query-imessage.ts help` for available commands.
- `enrich` and `migrate-notes` commands are CLI-only (no MCP equivalent)

**Notes:**
- Commitment extraction runs inline — no post-processing needed
- Cursor file is shared between MCP and CLI — no drift when alternating
- Privacy-sensitive: see `~/code/personal-messages/docs/specs/privacy-and-retention.md`

## Contacts

| Connector | Tools |
|-----------|-------|
| `gog` | Bash via `gog`; see `references/gogcli-commands.md` |

**Common patterns:**
- Search by name for people cross-referencing
- Retrieve contact details for meeting attendees

## Sheets

| Connector | Tools |
|-----------|-------|
| `gog` | Bash via `gog`; see `references/gogcli-commands.md` |

**Common patterns:**
- Read a range for review loops (e.g., reconciliation CSVs round-tripped via Sheets)
- Append rows for batch logging
- Use `--json` for structured reads, plain text for simple writes
- Always pass the spreadsheet ID and A1 range explicitly — no implicit "active sheet"

## Drive

| Connector | Tools |
|-----------|-------|
| `gog` | Bash via `gog`; see `references/gogcli-commands.md` |

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
Each account's refresh token is bound to the OAuth client_id under which it
was issued (`gog --client <name> auth add <email>`). A different client can
return `unauthorized_client`. Pin `<connector>-client` in `.productivity.yml`
when repository routing must not depend on machine-local account/domain maps.

### Auth preflight
For a pinned or resolved client, use
`gog --client <name> --account <email> auth list --check --json --no-input` for
the selected token bucket and account. If no client is selected, use
`gog --account <email> auth list --check --json --no-input`. On failure, run the
matching `gog [--client <name>] --account <email> auth doctor --check --json
--no-input`. Branch on exit code 4 for unusable auth and 10 for missing local
configuration.

### Multi-client multi-terminal safety
Two terminals in two different repos (e.g., `monash-smst` with `calendar-client: monash` and `my-second-brain` with `calendar-client: personal`) can run gog commands concurrently without conflict — each client has a separate credentials file (`~/.config/gogcli/credentials-<name>.json`) and the refresh tokens for different accounts don't collide in Keychain. The only thing you **cannot** do is run two terminals both trying to re-auth the *same* account at the same time (Keychain write race). For normal read operations, parallelism is safe.

### Keyring access on headless/SSH
Set `GOG_KEYRING_BACKEND=file`, `GOG_KEYRING_PASSWORD`, and the intended
`GOG_HOME` on the service process. A successful interactive shell probe does
not prove that a desktop client, launch agent, or container inherited them.

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
- If absent: do not pass `--client`; gog applies its account/domain mappings,
  then falls back to `default`
- Never invent a client name. If the value in `.productivity.yml` doesn't
  appear in `gog auth credentials list`, stop and tell the user:
  "`<connector>-client: <name>` not registered — run
  `gog --client <name> auth credentials set <json>` first"

### 3. Command result handling

- On success, parse output according to the command owner.
- On failure, read stderr and skip with: `Skipped [source] -- gog error for [account]: [stderr summary]`.

### 4. Auth error recovery
If stderr mentions token expiry or auth failure:
- Skip the current source with a clear message
- Suggest the matching client-aware or default-client doctor command, then the
  matching `gog [--client <name>] auth add <email>` command when repair is
  required
- Continue to next source — never fail the entire sync for one connector

### 5. Wrong-account detection
Exit 0 with wrong data is undetectable at the CLI level. Prevention is the only strategy:
- Always use `--account <email>` (enforced by the dispatch protocol)
- Never rely on gogcli's default account selection
