---
name: notion-recent
description: List meetings from the last 7 days
allowed-tools: Bash
context: fork
user-invocable: true
---

# Task

List meetings from the last 7 days from Notion.

## Execute

```bash
source ~/.claude/skills/notion/lib/validate.sh
source ~/.claude/skills/notion/lib/api.sh

notion_validate_env || exit 1

query='{
  "filter": {"property": "Date", "date": {"past_week": {}}},
  "sorts": [{"property": "Date", "direction": "descending"}]
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

Present results with heading "Meetings from last 7 days":

| Date | Title | Status | ID |
|------|-------|--------|-----|

If no results, say "No meetings in the last 7 days."
