---
name: notion-search
description: Search meetings by title
allowed-tools: Bash
context: fork
user-invocable: true
argument-hint: <search-term>
---

# Task

Search meetings by title.

## Execute

```bash
source ~/.claude/skills/notion/lib/validate.sh
source ~/.claude/skills/notion/lib/api.sh

SEARCH_TERM="$ARGUMENTS"

if [ -z "$SEARCH_TERM" ]; then
  echo "Usage: /notion-search <term>"
  echo "Example: /notion-search standup"
  exit 1
fi

notion_validate_env || exit 1

query=$(jq -n --arg term "$SEARCH_TERM" '{
  "filter": {
    "property": "Title",
    "title": {"contains": $term}
  },
  "sorts": [{"property": "Date", "direction": "descending"}]
}')

body=$(notion_query_db "$NOTION_MEETINGS_DB_ID" "$query") || exit 1

count=$(printf '%s\n' "$body" | jq '.results | length')
echo "### Found $count meetings matching \"$SEARCH_TERM\""
echo ""

printf '%s\n' "$body" | jq -r '.results[] | [
  .properties.Date.date.start // "No date",
  .properties.Title.title[0].plain_text // "Untitled",
  .properties.Status.status.name // "-",
  .id
] | @tsv'
```

## Output

Present results with count header:

| Date | Title | Status | ID |
|------|-------|--------|-----|

If no results, say "No meetings found matching [term]."
