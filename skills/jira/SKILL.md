---
name: jira
description: Jira CLI building block. View tickets, list issues, manage sprints, comments, assignments, and status transitions. Composes into workflow skills.
allowed-tools: Bash
context: fork
model: haiku
user-invocable: false
argument-hint: <operation> [key] [options]
---

# Task

Execute a Jira CLI operation. Your arguments:
- **Operation:** `$0`
- **Key:** `$1` (ticket key, may be empty for list operations)
- **All args:** `$ARGUMENTS`

**Project:** POS | **User:** nathan.vale1@bunnings.com.au | **Board:** 1536

## Step 1: Validate

Parse `$0` from `$ARGUMENTS`. It must be one of:

`view` | `mine` | `wip` | `sprint` | `search` | `comment` | `create` | `edit` | `move` | `assign` | `attachments`

If `$0` is not recognized, output an error and stop:
```
### Result
Unknown operation: "$0". Expected: view, mine, wip, sprint, search, comment, create, edit, move, assign.

### Context for Caller
- status: failed
- operation: $0
- error: unknown_operation
```

## Step 2: Execute

Run the CLI command for the matched operation. Use `--plain` for machine-readable output on list operations.

### view
```bash
jira issue view $1 --comments 10
```

### mine
```bash
jira issue list -p POS -a "nathan.vale1@bunnings.com.au" --plain --columns KEY,SUMMARY,STATUS,ASSIGNEE
```

### wip
```bash
jira issue list -p POS -a "nathan.vale1@bunnings.com.au" -s "In Progress" --plain --columns KEY,SUMMARY,STATUS
```

### sprint
```bash
jira issue list -p POS -q "sprint in openSprints()" --plain --columns KEY,SUMMARY,STATUS,ASSIGNEE
```

### search
Remaining args after `search` form the JQL query:
```bash
jira issue list -p POS -q "REMAINING_ARGS" --plain --columns KEY,SUMMARY,STATUS,ASSIGNEE
```
For JQL reference, read [JQL.md](JQL.md).

### comment
`$1` = ticket key, remaining args = comment body.
```bash
jira issue comment add $1 -b "COMMENT_TEXT"
```

### create
Parse type, summary, priority, description from remaining args.
```bash
jira issue create -p POS -t TYPE -s "SUMMARY" -y PRIORITY --no-input
```
For stories, add custom fields:
```bash
jira issue create -p POS -t Story -s "SUMMARY" --custom "Tech Delivery Squad=POS Yellow" --no-input
```

### edit
`$1` = ticket key, remaining args = field updates.
```bash
jira issue edit $1 [flags] --no-input
```

### move
`$1` = ticket key, `$2` = target status.
```bash
jira issue move $1 "STATUS"
```
For valid status transitions, read [WORKFLOW.md](WORKFLOW.md).

### assign
`$1` = ticket key, `$2` = assignee (defaults to nathan.vale1@bunnings.com.au).
```bash
jira issue assign $1 ASSIGNEE
```
Use `x` as assignee to unassign.

### attachments
`$1` = ticket key, `$2` = optional output directory (defaults to `~/.claude/state/tickets/$1/attachments`).

Lists and optionally downloads all attachments from a ticket.

#### Attachment Metadata

The `jira` CLI does NOT have a built-in attachment command. Metadata lives in the raw JSON response under `fields.attachment[]`. Use `--raw` to access it:

```bash
jira issue view $1 --raw | python3 -c "
import json, sys
data = json.load(sys.stdin)
attachments = data.get('fields', {}).get('attachment', [])
print(json.dumps(attachments, indent=2))
"
```

Each attachment object contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique attachment ID (used in download URL) |
| `filename` | string | Original filename (e.g., `image-20260128-232102.png`) |
| `mimeType` | string | MIME type (e.g., `image/png`, `application/pdf`) |
| `size` | number | File size in bytes |
| `content` | string | Download URL: `https://bunnings.atlassian.net/rest/api/3/attachment/content/{id}` |
| `created` | string | ISO 8601 timestamp with timezone |
| `author.displayName` | string | Who uploaded the attachment |

**Metadata-only listing** (compact format):
```bash
jira issue view $1 --raw | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data.get('fields', {}).get('attachment', []):
    print(f\"{a['id']}:{a['filename']}:{a['size']}:{a['mimeType']}\")
"
```

#### Downloading Attachments

**Steps:**
1. Get attachment metadata (see above)
2. Create output directory: `mkdir -p $OUTPUT_DIR`
3. Download each attachment (the content URL returns a 303 redirect, so `-L` is required):
```bash
curl -sL -o "$OUTPUT_DIR/$FILENAME" \
  -H "Authorization: Basic $(echo -n 'nathan.vale1@bunnings.com.au:'\"$JIRA_API_TOKEN\" | base64)" \
  "https://bunnings.atlassian.net/rest/api/3/attachment/content/$ID"
```
4. Verify downloads have non-zero file sizes.

**Auth:** Uses `$JIRA_API_TOKEN` env var. Basic auth = base64-encoded `email:token`.

**Critical gotcha:** The `/rest/api/3/attachment/content/{id}` endpoint returns a `303 See Other` redirect to `api.media.atlassian.com` with a signed temporary URL. You MUST use `curl -L` to follow the redirect. Without `-L`, files will be 0 bytes.

## Step 3: Structured Output

Format your response with two sections: a human-readable result and a machine-readable context block.

### Result
Present the CLI output in a clean, scannable format:
- For `view`: ticket summary, status, assignee, description excerpt, recent comments
- For list operations (`mine`, `wip`, `sprint`, `search`): formatted table of issues
- For write operations (`comment`, `create`, `edit`, `move`, `assign`): confirmation of action taken

### Context for Caller
Always include these fields:
```
- status: success|failed
- operation: <the operation>
- key: <ticket key if applicable>
```

Plus operation-specific fields:

| Operation | Extra Fields |
|-----------|-------------|
| `view` | `type`, `status`, `assignee`, `priority`, `summary` |
| `mine` | `count`, `keys` (comma-separated) |
| `wip` | `count`, `keys` (comma-separated) |
| `sprint` | `count`, `sprint_name` |
| `search` | `count`, `query` |
| `comment` | `comment_added: true` |
| `create` | `key` (newly created), `type`, `summary` |
| `edit` | `fields_updated` (comma-separated field names) |
| `move` | `from_status`, `to_status` |
| `assign` | `assignee` |
| `attachments` | `count`, `filenames` (comma-separated), `output_dir` |

## Reference

- [Examples](EXAMPLES.md) — Common queries and expected output
- [JQL Patterns](JQL.md) — Advanced search patterns
- [Workflow](WORKFLOW.md) — POS status transitions
