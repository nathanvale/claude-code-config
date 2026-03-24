#!/bin/bash
# Environment validation for Notion skills

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
