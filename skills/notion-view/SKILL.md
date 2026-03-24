---
name: notion-view
description: View a specific meeting with its transcript
allowed-tools: Bash
context: fork
user-invocable: true
argument-hint: <meeting-id>
---

# Task

View a specific meeting from Notion, including its content/transcript.

**Arguments:** `$ARGUMENTS` = The meeting page ID (from `/notion-list`)

## Execute

```bash
source ~/.claude/skills/notion/lib/validate.sh
source ~/.claude/skills/notion/lib/api.sh

PAGE_ID="$ARGUMENTS"

if [ -z "$PAGE_ID" ]; then
  echo "Usage: /notion-view <meeting-id>"
  echo "Get IDs from /notion-list"
  exit 1
fi

notion_validate_env || exit 1

# Step 1: Get metadata
page=$(notion_get_page "$PAGE_ID") || exit 1

printf '%s\n' "### Meeting: $(printf '%s\n' "$page" | jq -r '.properties.Title.title[0].plain_text // "Untitled"')"
echo ""
printf '%s\n' "- **Date:** $(printf '%s\n' "$page" | jq -r '.properties.Date.date.start // "Not set"')"
printf '%s\n' "- **Status:** $(printf '%s\n' "$page" | jq -r '.properties.Status.status.name // "Not set"')"
printf '%s\n' "- **Priority:** $(printf '%s\n' "$page" | jq -r '.properties["Priority Level"].status.name // "Not set"')"
echo ""

# Step 2: Get content blocks
blocks=$(notion_get_blocks "$PAGE_ID") || exit 1

echo "### Content"
echo ""

printf '%s\n' "$blocks" | jq -r '.results[] |
  if .type == "paragraph" then
    (.paragraph.rich_text | map(.plain_text) | join(""))
  elif .type == "heading_1" then
    "# " + (.heading_1.rich_text | map(.plain_text) | join(""))
  elif .type == "heading_2" then
    "## " + (.heading_2.rich_text | map(.plain_text) | join(""))
  elif .type == "heading_3" then
    "### " + (.heading_3.rich_text | map(.plain_text) | join(""))
  elif .type == "bulleted_list_item" then
    "- " + (.bulleted_list_item.rich_text | map(.plain_text) | join(""))
  elif .type == "numbered_list_item" then
    "1. " + (.numbered_list_item.rich_text | map(.plain_text) | join(""))
  elif .type == "toggle" then
    "> " + (.toggle.rich_text | map(.plain_text) | join(""))
  elif .type == "quote" then
    "> " + (.quote.rich_text | map(.plain_text) | join(""))
  elif .type == "divider" then
    "---"
  else
    empty
  end | select(. != "")'
```

## Output

Present the meeting with metadata and full content/transcript.
