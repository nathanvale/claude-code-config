# gogcli Command Reference

Read this file when the active connector is `gog` and you need the exact bash invocation for a calendar, gmail, contacts, or sheets operation.

**Binary:** `gog` (gogcli v0.12.0)
**Auth:** OAuth tokens managed by gogcli's keyring. Use `gog auth list --json` to check status.

## Calendar

```bash
# Today only
gog calendar events --account <email> --today --json

# Forward window (next N days from today)
gog calendar events --account <email> --from today --days 3 --json

# Past window (requires ISO date — no relative arithmetic)
gog calendar events --account <email> --from $(date -v-2d +%Y-%m-%d) --to today --json

# Specific date range
gog calendar events --account <email> --from 2026-03-28 --to 2026-03-30 --json

# This week (Mon–Sun by default)
gog calendar events --account <email> --week --json

# All calendars (not just primary)
gog calendar events --account <email> --today --all --json

# Free text search within events
gog calendar events --account <email> --from today --days 7 --query "standup" --json

# Auto-paginate (when --max is hit)
gog calendar events --account <email> --from today --days 30 --all-pages --json
```

**Default sync pattern (past 2 days + next 3 days):**
```bash
gog calendar events --account <email> --from $(date -v-2d +%Y-%m-%d) --to today --json
gog calendar events --account <email> --from today --days 3 --json
```

**Defaults:** `--max=10`, calendar=primary. Use `--all` for all calendars, `--all-pages` to auto-paginate beyond max.

## Gmail

```bash
# Unread inbox (default --max=10, pass explicitly for more)
gog gmail search "is:unread" --account <email> --json --max 20

# Search by sender
gog gmail search "from:someone@example.com" --account <email> --json

# Search by subject
gog gmail search "subject:weekly report" --account <email> --json

# Sent messages (for commitment extraction)
gog gmail search "in:sent" --account <email> --json --max 20

# Date-scoped search
gog gmail search "after:2026/03/28 before:2026/03/30" --account <email> --json

# Auto-paginate all results
gog gmail search "is:unread" --account <email> --json --all

# Read a specific thread (full messages)
gog gmail thread get <threadId> --account <email> --json

# List attachments in a thread
gog gmail thread attachments <threadId> --account <email> --json

# Force timezone on output
gog gmail search "is:unread" --account <email> --json --timezone "Australia/Melbourne"
```

**Default sync pattern (unread inbox):**
```bash
gog gmail search "is:unread" --account <email> --json --max 20
```

**Deep sync pattern (sent messages for commitments):**
```bash
gog gmail search "in:sent" --account <email> --json --max 20
```

**Defaults:** `--max=10`. Always pass `--max` explicitly when you need more than 10 results.

## Contacts

Google Contacts has three pools. Most personal contacts are in the main pool. Workspace colleagues appear in directory. Auto-created contacts from email/calendar interactions appear in "other".

### Main contacts

```bash
# List all contacts (default --max=100; use --all for auto-pagination)
gog contacts list --account <email> --json --all

# Search by name (searches full set including contacts not returned by list)
gog contacts search "Jane Smith" --account <email> --json

# Search by phone number (cross-reference iMessage handles)
gog contacts search "+61412667520" --account <email> --json

# Search by email
gog contacts search "someone@example.com" --account <email> --json

# Get a specific contact (accepts resource ID or email)
gog contacts get people/c1667213438914232831 --account <email> --json
gog contacts get someone@example.com --account <email> --json
```

### Directory contacts (Workspace orgs)

```bash
# List Workspace directory contacts
gog contacts directory list --account <email> --json --all

# Search directory
gog contacts directory search "Jane" --account <email> --json
```

### Other contacts (auto-created)

```bash
# List other contacts (may hit Google API field restriction — see Gotchas)
gog contacts other list --account <email> --json --all

# Search other contacts
gog contacts other search "Jane" --account <email> --json
```

### Contacts gotchas

- **`list` defaults to `--max=100`** — use `--all` or `--max 500` to get all contacts. Without this you silently get a partial list.
- **`search` finds contacts that `list` misses** — `search` queries the full contact set (including recently interacted contacts). If `list` returns no result for someone, try `search` by name or phone.
- **`other list` may fail** with `Google API error (400 badRequest): Request field 'organizations' not allowed for other contacts read requests.` This is a gogcli bug — the workaround is `other search` instead.
- **Phone number format doesn't matter for search** — both `+61412667520` and `0412667520` work.

### Cross-reference pattern (iMessage → Google Contact)

To link a people note's iMessage handle to its Google Contact resource ID:
```bash
# Take the iMessage phone from source_handles.imessage in the people note
gog contacts search "+61412667520" --account <email> --json
# → returns resource ID (people/c...) to add as source_handles.google_contacts
```

## Sheets

```bash
# Read a range from a spreadsheet
gog sheets get <spreadsheetId> <range> --account <email> --json

# Example: read cells A1:D10 from a specific sheet
gog sheets get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms "Sheet1!A1:D10" --account <email> --json
```

**Note:** `gog sheets` only supports `get` (read a range). There is no `list` command — use Google Drive search to find spreadsheet IDs.

## Auth

```bash
# Check auth status for all accounts
gog auth list --json

# Add/refresh auth for an account
gog auth add <email>
```

## Pagination

Most `list` and `search` commands support these pagination flags:

| Flag | Purpose | Available on |
|------|---------|-------------|
| `--max=N` | Max results per page | All list/search commands |
| `--page=STRING` | Page token for manual pagination | All list/search commands |
| `--all` | Auto-fetch all pages | `contacts list`, `contacts other list`, `contacts directory list`, `gmail search` |
| `--all-pages` | Auto-fetch all pages | `calendar events` |
| `--fail-empty` | Exit code 3 if no results (useful for scripting) | `contacts list`, `gmail search`, `calendar events` |

**Important defaults:**
- `calendar events`: `--max=10`
- `gmail search`: `--max=10`
- `contacts list`: `--max=100`
- `contacts search`: `--max=50`
- `contacts directory list`: `--max=50`

Always use `--all` / `--all-pages` or an explicit `--max` when you need complete results.

## Date Flag Constraints

The `--from` and `--to` flags accept:
- ISO dates: `2026-03-28`
- Named days: `today`, `tomorrow`, `monday`

They do **NOT** accept relative arithmetic like `+3d` or `-2d`.

For past windows, compute the ISO date at dispatch time:
```bash
# macOS: 2 days ago
$(date -v-2d +%Y-%m-%d)

# macOS: 7 days ago (deep sync)
$(date -v-7d +%Y-%m-%d)
```

Use `--days=N` for forward windows from a start date.

## Global Flags

| Flag | Purpose |
|------|---------|
| `--json` | JSON output (always use for agent consumption) |
| `--plain` | Plain text output |
| `--no-input` | Non-interactive mode |
| `--results-only` | Omit metadata, return only results array |
| `--select=<fields>` | Select specific fields (comma-separated) |
| `--timezone=STRING` | Output timezone (IANA, e.g. `Australia/Melbourne`) |

## Error Handling

| Exit Code | Meaning | Recovery |
|-----------|---------|----------|
| 0 | Success | — |
| 3 | No results (when `--fail-empty` is used) | Expected — not an error |
| Non-zero | Error (auth expired, network, bad flags) | Read stderr for details |

**Auth expired:** stderr will mention token/auth. Recovery: `gog auth add <email>`

**Wrong account (silent failure):** Exit 0 but returns data from the wrong account. This happens when `--account` is omitted. Always pass `--account <email>` explicitly.

**Headless/SSH (Mac Mini):** Set `GOG_KEYRING_BACKEND=file` before running gog commands to avoid keychain access errors.
