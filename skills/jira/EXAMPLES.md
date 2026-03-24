# Jira Examples

## View Issue

```bash
jira issue view POS-2774
```

Shows: type, status, priority, assignee, description, comments

## My Assigned Issues

```bash
jira issue list -p POS -a "nathan.vale1@bunnings.com.au" --plain --columns KEY,SUMMARY,STATUS
```

## High Priority Items

```bash
jira issue list -p POS -yHigh --plain --columns KEY,SUMMARY,STATUS,ASSIGNEE
```

## Issues Updated This Week

```bash
jira issue list -p POS --updated week --plain
```

## Add Comment

```bash
jira issue comment add POS-2774 -b "Fixed in commit abc123"
```

## Create Issue

```bash
# Basic task
jira issue create -p POS -t Task -s "Add MSW local dev mocking" -y Medium --no-input

# With description (use -b for body)
jira issue create -p POS -t Task -s "Enable feature X" -y High -b "Description here" --no-input

# With labels
jira issue create -p POS -t Bug -s "Fix login issue" -y High -l bug -l urgent --no-input
```

### Creating Stories (Sprint Board)

**IMPORTANT:** To get Stories into the sprint board, you MUST set:
1. **Tech Delivery Squad** → "POS Yellow"
2. **Sprint** → Current sprint (always starts with "POS Yellow FY26")

```bash
# First, find the current sprint ID
jira sprint list -b 1536 --plain | grep "POS Yellow FY26"

# Create story with squad and sprint
jira issue create -p POS -t Story -s "Story summary" -y Medium \
  --custom "Tech Delivery Squad=POS Yellow" \
  --custom "Sprint=SPRINT_ID" \
  --no-input
```

**Flags:**
- `-p` project (POS)
- `-t` type (Task, Bug, Story, Epic)
- `-s` summary/title
- `-y` priority (Highest, High, Medium, Low, Lowest)
- `-b` body/description
- `-l` labels (repeatable)
- `-a` assignee
- `--custom` set custom field (repeatable)
- `--no-input` skip interactive prompts

## Edit/Update Issue

```bash
# Update summary
jira issue edit POS-2774 -s "New summary" --no-input

# Update description
jira issue edit POS-2774 -b "New description content" --no-input

# Update priority
jira issue edit POS-2774 -y High --no-input

# Update multiple fields
jira issue edit POS-2774 -s "Summary" -b "Description" -y Medium --no-input

# Add labels
jira issue edit POS-2774 -l newlabel --no-input

# Remove label (prefix with -)
jira issue edit POS-2774 --label -oldlabel --no-input
```

**Flags:**
- `-s` summary
- `-b` body/description
- `-y` priority
- `-a` assignee
- `-l` add label
- `--label -X` remove label
- `-C` replace components
- `--no-input` skip prompts

## Move Issue Status

```bash
jira issue move POS-2774 "In Progress"
jira issue move POS-2774 "Done"
```

## Assign Issue

```bash
# Assign to Nathan
jira issue assign POS-2774 "nathan.vale1@bunnings.com.au"

# Assign to self (current user)
jira issue assign POS-2774 $(jira me)

# Unassign
jira issue assign POS-2774 x

# Assign to default assignee
jira issue assign POS-2774 default
```

**Note:** Assignee must be exact email or display name match.

## Attachment Metadata

```bash
# List all attachments (metadata only — no download)
jira issue view POS-3154 --raw | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data.get('fields', {}).get('attachment', []):
    size_kb = a['size'] / 1024
    print(f\"  {a['id']}  {a['filename']:<40s}  {size_kb:>7.0f}KB  {a['mimeType']}\")
"

# Check if a ticket has attachments (quick boolean)
jira issue view POS-3154 --raw | python3 -c "
import json, sys
data = json.load(sys.stdin)
count = len(data.get('fields', {}).get('attachment', []))
print(f'{count} attachment(s)')
"

# Get full metadata as JSON (for piping to other tools)
jira issue view POS-3154 --raw | python3 -c "
import json, sys
data = json.load(sys.stdin)
attachments = data.get('fields', {}).get('attachment', [])
print(json.dumps([{
    'id': a['id'],
    'filename': a['filename'],
    'mimeType': a['mimeType'],
    'size': a['size'],
    'content': a['content'],
    'created': a['created'],
    'author': a.get('author', {}).get('displayName', 'Unknown'),
} for a in attachments], indent=2))
"
```

## Download Attachments

```bash
# 1. Get attachment IDs and filenames
jira issue view POS-3154 --raw | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data.get('fields', {}).get('attachment', []):
    print(f\"{a['id']}:{a['filename']}\")
"

# 2. Download each attachment (MUST use -L to follow 303 redirect)
curl -sL -o "output.png" \
  -H "Authorization: Basic $(echo -n 'nathan.vale1@bunnings.com.au:'\"$JIRA_API_TOKEN\" | base64)" \
  "https://bunnings.atlassian.net/rest/api/3/attachment/content/630560"

# 3. Batch download all to a directory
mkdir -p ~/.claude/state/tickets/POS-3154/attachments
# Then loop over id:filename pairs from step 1
```

**Gotcha:** The `/rest/api/3/attachment/content/{id}` endpoint returns a `303 See Other` redirect to `api.media.atlassian.com`. Without `curl -L`, you get 0-byte files. Auth uses `$JIRA_API_TOKEN` env var with Basic auth (email:token base64-encoded).
