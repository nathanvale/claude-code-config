---
name: notion-list
description: List all meetings from Notion (most recent first)
allowed-tools: Bash
context: fork
user-invocable: true
---

# Task

List all meetings from the Notion Meetings database.

## Execute

```bash
source ~/.claude/skills/notion/lib/validate.sh
source ~/.claude/skills/notion/lib/api.sh

notion_validate_env || exit 1

query='{
  "sorts": [{"property": "Date", "direction": "descending"}],
  "page_size": 50
}'

body=$(notion_query_db "$NOTION_MEETINGS_DB_ID" "$query") || exit 1

printf '%s\n' "$body" | jq -r '.results[] | [
  .properties.Date.date.start // "No date",
  .properties.Title.title[0].plain_text // "Untitled",
  .properties.Status.status.name // "-",
  .id
] | @tsv'
```

## Output

Present results as a markdown table:

| Date | Title | Status | ID |
|------|-------|--------|-----|

If no results, say "No meetings found."

Add note: "Use `/notion-view <id>` to see meeting details and transcript"
