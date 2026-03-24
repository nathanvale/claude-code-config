#!/bin/bash
# Notion API helper functions

source ~/.claude/skills/notion/config.sh

# Trim whitespace from token (1Password sometimes adds leading spaces)
NOTION_API_TOKEN="${NOTION_API_TOKEN## }"
NOTION_API_TOKEN="${NOTION_API_TOKEN%% }"

notion_request() {
  local endpoint="$1"
  local method="${2:-GET}"
  local data="$3"

  local url="${NOTION_API_BASE}/${endpoint}"

  if [ "${NOTION_DEBUG:-false}" = "true" ]; then
    echo "DEBUG: $method $url" >&2
    [ -n "$data" ] && echo "DEBUG: $data" >&2
  fi

  local args=(-s -w "\n%{http_code}")
  args+=(-X "$method")
  args+=(-H "Authorization: Bearer $NOTION_API_TOKEN")
  args+=(-H "Notion-Version: $NOTION_API_VERSION")
  args+=(-H "Content-Type: application/json")
  [ -n "$data" ] && args+=(-d "$data")

  local response=$(curl "${args[@]}" "$url")
  local http_code=$(printf '%s\n' "$response" | tail -1)
  local body=$(printf '%s\n' "$response" | sed '$d')

  if [ "${NOTION_DEBUG:-false}" = "true" ]; then
    echo "DEBUG: HTTP $http_code" >&2
  fi

  if [ "$http_code" != "200" ]; then
    notion_error "$http_code" "$body" "$endpoint"
    return 1
  fi

  printf '%s\n' "$body"
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
    *) echo "HTTP $code: $(printf '%s\n' "$body" | jq -r '.message // "Unknown error"')" ;;
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
