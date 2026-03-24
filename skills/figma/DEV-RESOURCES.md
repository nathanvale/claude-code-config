# Figma Dev Resources API

Link code files to Figma design frames for design-to-code traceability.

**Required scope:** `file_dev_resources:write`

## Use Cases

- Link React components to their Figma design frames
- Connect page implementations to mockups
- Create bidirectional traceability between design and code
- Auto-populate links during CI/CD or PR creation

## Quick Commands

### List Dev Resources

```bash
curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/dev_resources" | \
  jq '.dev_resources[] | {name, url, node_id}'
```

### Create Dev Resource

```bash
curl -X POST \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  -H "Content-Type: application/json" \
  -d '{
    "dev_resources": [{
      "name": "React Component",
      "url": "https://github.com/org/repo/blob/main/src/components/Button.tsx",
      "node_id": "'"$NODE_ID"'"
    }]
  }' \
  "https://api.figma.com/v1/files/$FILE_KEY/dev_resources"
```

### Update Dev Resource

```bash
RESOURCE_ID="existing_resource_id"

curl -X PUT \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  -H "Content-Type: application/json" \
  -d '{
    "dev_resources": [{
      "id": "'"$RESOURCE_ID"'",
      "name": "Updated Component Name",
      "url": "https://github.com/org/repo/blob/main/src/NewPath.tsx"
    }]
  }' \
  "https://api.figma.com/v1/files/$FILE_KEY/dev_resources"
```

### Delete Dev Resource

```bash
RESOURCE_IDS="id1,id2,id3"

curl -X DELETE \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/dev_resources?ids=$RESOURCE_IDS"
```

## Workflows

### Link Component to Design

After implementing a component, link it to the Figma frame:

```bash
#!/bin/bash
# link-component.sh

FILE_KEY="$1"
NODE_ID="$2"
COMPONENT_PATH="$3"
COMPONENT_NAME="${4:-$(basename "$COMPONENT_PATH" .tsx)}"

# Build GitHub URL
REPO_URL="https://github.com/bunnings/gms.app"
BRANCH="main"
FULL_URL="$REPO_URL/blob/$BRANCH/$COMPONENT_PATH"

curl -X POST \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  -H "Content-Type: application/json" \
  -d "{
    \"dev_resources\": [{
      \"name\": \"$COMPONENT_NAME\",
      \"url\": \"$FULL_URL\",
      \"node_id\": \"$NODE_ID\"
    }]
  }" \
  "https://api.figma.com/v1/files/$FILE_KEY/dev_resources"
```

### Batch Link from Git Changes

Link all changed files to their corresponding Figma frames:

```bash
#!/bin/bash
# link-changed-files.sh

FILE_KEY="$1"
REPO_URL="https://github.com/bunnings/gms.app"
BRANCH=$(git branch --show-current)

# Get changed TSX files
CHANGED_FILES=$(git diff main --name-only | grep -E '\.tsx$')

for FILE in $CHANGED_FILES; do
  # Extract component name
  COMPONENT_NAME=$(basename "$FILE" .tsx)

  # Try to find matching Figma frame (you'd need a mapping)
  # This is simplified - real implementation would use a mapping file
  echo "Would link: $COMPONENT_NAME -> $REPO_URL/blob/$BRANCH/$FILE"
done
```

### Auto-Link from Page Route

Link page implementations based on route patterns:

```bash
#!/bin/bash
# link-page.sh

FILE_KEY="$1"
ROUTE="$2"  # e.g., /bulkprint/create
REPO_URL="https://github.com/bunnings/gms.app"

# Map route to file path (simplified)
case "$ROUTE" in
  "/bulkprint/create")
    FILE_PATH="src/pages/BulkPrint/CreateBulkPrintOrderPage.tsx"
    ;;
  "/orders")
    FILE_PATH="src/pages/Orders/OnlineOrders/OnlineOrdersPage.tsx"
    ;;
  *)
    echo "Unknown route: $ROUTE"
    exit 1
    ;;
esac

# Find the Figma frame by name
FRAME_NAME=$(echo "$ROUTE" | tr '/' ' ' | xargs)  # Clean up route for search

NODE_ID=$(curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY?depth=2" | \
  jq -r --arg name "$FRAME_NAME" \
  '.document.children[0].children[] | select(.name | ascii_downcase | contains($name | ascii_downcase)) | .id' | head -1)

if [ -n "$NODE_ID" ]; then
  curl -X POST \
    -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
    -H "Content-Type: application/json" \
    -d "{
      \"dev_resources\": [{
        \"name\": \"Page Implementation\",
        \"url\": \"$REPO_URL/blob/main/$FILE_PATH\",
        \"node_id\": \"$NODE_ID\"
      }]
    }" \
    "https://api.figma.com/v1/files/$FILE_KEY/dev_resources"
fi
```

### Get Resources for Node

```bash
NODE_ID="1:234"

curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/dev_resources" | \
  jq --arg node "$NODE_ID" '[.dev_resources[] | select(.node_id == $node)]'
```

## Resource Types

### GitHub File Link

```json
{
  "name": "Button.tsx",
  "url": "https://github.com/org/repo/blob/main/src/components/Button.tsx",
  "node_id": "1:234"
}
```

### Storybook Link

```json
{
  "name": "Button Story",
  "url": "https://storybook.example.com/?path=/story/button",
  "node_id": "1:234"
}
```

### Documentation Link

```json
{
  "name": "Component Docs",
  "url": "https://docs.example.com/components/button",
  "node_id": "1:234"
}
```

### PR Link

```json
{
  "name": "Implementation PR",
  "url": "https://github.com/org/repo/pull/123",
  "node_id": "1:234"
}
```

## Naming Conventions

Use consistent naming for easy discovery:

| Type | Name Pattern | Example |
|------|--------------|---------|
| Component | `ComponentName.tsx` | `Button.tsx` |
| Page | `Page: RouteName` | `Page: /orders` |
| Storybook | `Story: ComponentName` | `Story: Button` |
| PR | `PR #number` | `PR #123` |
| Docs | `Docs: Topic` | `Docs: Button API` |

## Integration with figma-compare

After a successful comparison, automatically link the code:

```bash
# In figma-compare workflow, after validation passes
if [ "$COMPARISON_PASSED" = true ]; then
  # Get the file being compared
  IMPLEMENTATION_FILE=$(git diff main --name-only | grep -E "$ROUTE_PATTERN" | head -1)

  if [ -n "$IMPLEMENTATION_FILE" ]; then
    bash ~/.claude/skills/figma/scripts/link-component.sh \
      "$FILE_KEY" "$NODE_ID" "$IMPLEMENTATION_FILE"
  fi
fi
```

## Checking for Existing Links

Before creating, check if link already exists:

```bash
check_existing_link() {
  local file_key="$1"
  local node_id="$2"
  local url="$3"

  EXISTING=$(curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
    "https://api.figma.com/v1/files/$file_key/dev_resources" | \
    jq -r --arg node "$node_id" --arg url "$url" \
    '.dev_resources[] | select(.node_id == $node and .url == $url) | .id')

  if [ -n "$EXISTING" ]; then
    echo "Link already exists: $EXISTING"
    return 0
  else
    return 1
  fi
}

# Usage
if ! check_existing_link "$FILE_KEY" "$NODE_ID" "$URL"; then
  # Create new link
  curl -X POST ...
fi
```

## Limitations

- Maximum 100 dev resources per file
- URL must be valid and accessible
- Node must exist in the file
- Rate limit: Tier 2 (see RATE-LIMITS.md)
