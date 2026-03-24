# Notion Skills Integration Plan

**Status:** Draft
**Created:** 2026-02-12
**Owner:** Nathan

---

## Overview

Refactor Notion meeting skills from MVP to production-ready, addressing staff engineer review findings.

## Current State

```
~/.claude/skills/
├── notion/           # Reference doc only
├── notion-list/      # Works, but duplicates HTTP logic
├── notion-recent/    # Works, but duplicates HTTP logic
└── notion-view/      # Incomplete - Step 2 not implemented
```

**Issues:**
- HTTP boilerplate duplicated 3x
- No env validation (silent failures)
- notion-view doesn't fetch transcripts
- No pagination (max 20 meetings)
- Hardcoded property names

---

## Target State

```
~/.claude/skills/
├── notion/
│   ├── SKILL.md              # Reference doc (existing)
│   ├── lib/
│   │   ├── api.sh            # Shared HTTP helper
│   │   ├── validate.sh       # Env validation
│   │   └── format.jq         # Shared jq filters
│   └── config.sh             # Property names, API version
├── notion-list/
│   └── SKILL.md              # Uses shared lib
├── notion-recent/
│   └── SKILL.md              # Uses shared lib
├── notion-view/
│   └── SKILL.md              # Complete with transcript parsing
└── notion-search/
    └── SKILL.md              # New: search by title/date
```

---

## Implementation Phases

### Phase 1: Foundation (30 min)

**Goal:** Extract shared utilities, fix duplication

#### 1.1 Create config.sh
```bash
# ~/.claude/skills/notion/config.sh
export NOTION_API_VERSION="2022-06-28"
export NOTION_API_BASE="https://api.notion.com/v1"

# Property mappings (change here if schema changes)
export NOTION_PROP_TITLE="Title"
export NOTION_PROP_DATE="Date"
export NOTION_PROP_STATUS="Status"
export NOTION_PROP_PRIORITY="Priority Level"
export NOTION_PROP_TAGS="Tags"
```

#### 1.2 Create lib/validate.sh
```bash
# ~/.claude/skills/notion/lib/validate.sh
notion_validate_env() {
  local errors=0

  if [ -z "$NOTION_API_TOKEN" ]; then
    echo "### Error: NOTION_API_TOKEN not set"
    echo "Run: \`sync-api-keys\` then \`source ~/.zshrc\`"
    errors=1
  fi

  if [ -z "$NOTION_MEETINGS_DB_ID" ]; then
    echo "### Error: NOTION_MEETINGS_DB_ID not set"
    echo "Add to 1Password vault 'API Credentials' then \`sync-api-keys\`"
    errors=1
  fi

  return $errors
}
```

#### 1.3 Create lib/api.sh
```bash
# ~/.claude/skills/notion/lib/api.sh
source ~/.claude/skills/notion/config.sh

notion_request() {
  local endpoint="$1"
  local method="${2:-GET}"
  local data="$3"

  local url="${NOTION_API_BASE}/${endpoint}"
  local args=(-s -w "\n%{http_code}")
  args+=(-X "$method")
  args+=(-H "Authorization: Bearer $NOTION_API_TOKEN")
  args+=(-H "Notion-Version: $NOTION_API_VERSION")
  args+=(-H "Content-Type: application/json")
  [ -n "$data" ] && args+=(-d "$data")

  local response=$(curl "${args[@]}" "$url")
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)

  if [ "$http_code" != "200" ]; then
    notion_error "$http_code" "$body" "$endpoint"
    return 1
  fi

  echo "$body"
}

notion_error() {
  local code="$1"
  local body="$2"
  local context="$3"

  echo "### Error: $context"
  case "$code" in
    401) echo "Authentication failed. Check NOTION_API_TOKEN is valid." ;;
    403) echo "Permission denied. Share database with your integration." ;;
    404) echo "Not found. Check the ID exists in Notion." ;;
    429) echo "Rate limited. Wait 60 seconds and retry." ;;
    *) echo "HTTP $code: $(echo "$body" | jq -r '.message // "Unknown error"')" ;;
  esac
}

notion_query_db() {
  local db_id="$1"
  local query="$2"
  notion_request "databases/${db_id}/query" "POST" "$query"
}

notion_get_page() {
  local page_id="$1"
  notion_request "pages/${page_id}" "GET"
}

notion_get_blocks() {
  local page_id="$1"
  local page_size="${2:-100}"
  notion_request "blocks/${page_id}/children?page_size=${page_size}" "GET"
}
```

---

### Phase 2: Refactor Skills (20 min)

**Goal:** Update skills to use shared lib

#### 2.1 Update notion-list/SKILL.md

```markdown
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

echo "$body" | jq -r '.results[] | [
  .properties.Date.date.start // "No date",
  .properties.Title.title[0].plain_text // "Untitled",
  .properties.Status.status.name // "-",
  .id
] | @tsv'
```
```

#### 2.2 Update notion-recent/SKILL.md

Same pattern, different query filter.

#### 2.3 Complete notion-view/SKILL.md

```markdown
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

echo "### Meeting: $(echo "$page" | jq -r '.properties.Title.title[0].plain_text')"
echo ""
echo "- **Date:** $(echo "$page" | jq -r '.properties.Date.date.start // "Not set"')"
echo "- **Status:** $(echo "$page" | jq -r '.properties.Status.status.name // "Not set"')"
echo "- **Priority:** $(echo "$page" | jq -r '.properties["Priority Level"].status.name // "Not set"')"
echo ""

# Step 2: Get content blocks
blocks=$(notion_get_blocks "$PAGE_ID") || exit 1

echo "### Content"
echo ""

echo "$blocks" | jq -r '.results[] |
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
```

---

### Phase 3: Add Search (10 min)

**Goal:** New skill for searching meetings

#### 3.1 Create notion-search/SKILL.md

```markdown
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

count=$(echo "$body" | jq '.results | length')
echo "### Found $count meetings matching \"$SEARCH_TERM\""
echo ""

echo "$body" | jq -r '.results[] | [
  .properties.Date.date.start // "No date",
  .properties.Title.title[0].plain_text // "Untitled",
  .id
] | @tsv'
```
```

---

### Phase 4: Testing & Docs (10 min)

#### 4.1 Add debug mode to lib/api.sh

```bash
# At top of notion_request()
if [ "${NOTION_DEBUG:-false}" = "true" ]; then
  echo "DEBUG: $method $url" >&2
  [ -n "$data" ] && echo "DEBUG: $data" >&2
fi
```

#### 4.2 Update notion/SKILL.md reference

Add sections for:
- Environment variables
- Debugging (`NOTION_DEBUG=true /notion-list`)
- Property mappings
- Troubleshooting guide

---

## Verification Checklist

- [ ] `sync-api-keys` shows both Notion keys
- [ ] `/notion-list` shows meetings table
- [ ] `/notion-recent` shows last 7 days (or "no meetings")
- [ ] `/notion-view <id>` shows metadata AND content
- [ ] `/notion-search test` finds matching meetings
- [ ] Missing env var shows helpful error
- [ ] Invalid ID shows helpful error
- [ ] `NOTION_DEBUG=true` shows request details

---

## Rollback

If issues occur:
1. Skills are in `~/.claude/skills/` (not in dotfiles repo)
2. Delete and recreate from this plan
3. Env vars remain in 1Password

---

## Future Enhancements (Not in Scope)

- Pagination for >50 meetings
- `/notion-update` to change status
- `/notion-create` for new meetings
- Retry logic with exponential backoff
- Test fixtures for offline dev
