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
```

**Default sync pattern (past 2 days + next 3 days):**
```bash
gog calendar events --account <email> --from $(date -v-2d +%Y-%m-%d) --to today --json
gog calendar events --account <email> --from today --days 3 --json
```

## Gmail

```bash
# Unread inbox
gog gmail search "is:unread" --account <email> --json --max 20

# Search by sender
gog gmail search "from:someone@example.com" --account <email> --json

# Search by subject
gog gmail search "subject:weekly report" --account <email> --json

# Sent messages (for commitment extraction)
gog gmail search "in:sent" --account <email> --json --max 20

# Read a specific thread
gog gmail thread get <threadId> --account <email> --json
```

**Default sync pattern (unread inbox):**
```bash
gog gmail search "is:unread" --account <email> --json --max 20
```

**Deep sync pattern (sent messages for commitments):**
```bash
gog gmail search "in:sent" --account <email> --json --max 20
```

## Contacts

```bash
# List all contacts
gog contacts list --account <email> --json

# Search by name
gog contacts search "Jane Smith" --account <email> --json

# Search by email domain
gog contacts search "@monash.edu" --account <email> --json

# Get a specific contact
gog contacts get <resourceName> --account <email> --json
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

## Error Handling

| Exit Code | Meaning | Recovery |
|-----------|---------|----------|
| 0 | Success | — |
| Non-zero | Error (auth expired, network, bad flags) | Read stderr for details |

**Auth expired:** stderr will mention token/auth. Recovery: `gog auth add <email>`

**Wrong account (silent failure):** Exit 0 but returns data from the wrong account. This happens when `--account` is omitted. Always pass `--account <email>` explicitly.

**Headless/SSH (Mac Mini):** Set `GOG_KEYRING_BACKEND=file` before running gog commands to avoid keychain access errors.
