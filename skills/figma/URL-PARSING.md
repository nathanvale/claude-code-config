# Figma URL Parsing

## URL Formats

Figma uses several URL patterns:

| Type | Pattern | Example |
|------|---------|---------|
| Design file | `/design/:key/:name` | `figma.com/design/abc123/My-Design` |
| File (legacy) | `/file/:key/:name` | `figma.com/file/abc123/My-Design` |
| With node | `...?node-id=:id` | `...?node-id=1%3A234` |
| With version | `...?version-id=:ver` | `...?version-id=1234567890` |
| FigJam | `/board/:key/:name` | `figma.com/board/abc123/My-Board` |
| Prototype | `/proto/:key/:name` | `figma.com/proto/abc123/My-Proto` |

## Extract File Key

The file key is the unique identifier needed for all API calls.

### From Design/File URL

```bash
FIGMA_URL="https://www.figma.com/design/4Fyf2Q3AtrsV06ktJnpcaT/GMS---Resellers"

# Method 1: grep
FILE_KEY=$(echo "$FIGMA_URL" | grep -oE '(design|file|board|proto)/[^/]+' | cut -d'/' -f2)

# Method 2: sed
FILE_KEY=$(echo "$FIGMA_URL" | sed -n 's|.*/\(design\|file\|board\|proto\)/\([^/]*\)/.*|\2|p')

# Method 3: awk
FILE_KEY=$(echo "$FIGMA_URL" | awk -F'/' '{for(i=1;i<=NF;i++) if($i~/design|file|board|proto/) print $(i+1)}')

echo $FILE_KEY
# Output: 4Fyf2Q3AtrsV06ktJnpcaT
```

### From URL with Query Params

```bash
FIGMA_URL="https://www.figma.com/design/abc123/Name?node-id=1%3A234&mode=dev"

# Strip query params first
FILE_KEY=$(echo "$FIGMA_URL" | cut -d'?' -f1 | grep -oE '(design|file)/[^/]+' | cut -d'/' -f2)
```

## Extract Node ID

Node IDs identify specific frames/elements within a file.

### From URL Query Parameter

```bash
FIGMA_URL="https://www.figma.com/design/abc123/Name?node-id=1%3A234"

# Extract and decode
NODE_ID=$(echo "$FIGMA_URL" | grep -oE 'node-id=[^&]+' | cut -d'=' -f2 | sed 's/%3A/:/g')

echo $NODE_ID
# Output: 1:234
```

### URL Encoding for API Calls

When using node IDs in API URLs, colons must be encoded:

```bash
NODE_ID="1:234"

# Encode for URL
ENCODED_ID=$(echo "$NODE_ID" | sed 's/:/%3A/g')
# Output: 1%3A234

# Use in API call
curl "https://api.figma.com/v1/images/$FILE_KEY?ids=$ENCODED_ID"
```

### Multiple Node IDs

```bash
NODE_IDS="1:234,1:235,1:236"

# Encode all colons
ENCODED_IDS=$(echo "$NODE_IDS" | sed 's/:/%3A/g')
# Output: 1%3A234,1%3A235,1%3A236
```

## Complete URL Parser

```bash
#!/bin/bash
# parse-figma-url.sh

parse_figma_url() {
  local url="$1"

  # Remove protocol
  local path="${url#*://}"

  # Extract file key
  local file_key=$(echo "$path" | grep -oE '(design|file|board|proto)/[^/?]+' | cut -d'/' -f2)

  # Extract node ID if present
  local node_id=""
  if [[ "$url" == *"node-id="* ]]; then
    node_id=$(echo "$url" | grep -oE 'node-id=[^&]+' | cut -d'=' -f2 | sed 's/%3A/:/g')
  fi

  # Extract version if present
  local version=""
  if [[ "$url" == *"version-id="* ]]; then
    version=$(echo "$url" | grep -oE 'version-id=[^&]+' | cut -d'=' -f2)
  fi

  # Determine file type
  local file_type="design"
  if [[ "$url" == *"/board/"* ]]; then
    file_type="figjam"
  elif [[ "$url" == *"/proto/"* ]]; then
    file_type="prototype"
  fi

  # Output as JSON
  cat <<EOF
{
  "url": "$url",
  "file_key": "$file_key",
  "node_id": "$node_id",
  "version": "$version",
  "type": "$file_type"
}
EOF
}

# Usage
parse_figma_url "$1"
```

## Validate Figma URL

```bash
is_figma_url() {
  local url="$1"
  if [[ "$url" =~ ^https://(www\.)?figma\.com/(design|file|board|proto)/[a-zA-Z0-9]+/ ]]; then
    return 0
  else
    return 1
  fi
}

# Usage
if is_figma_url "$URL"; then
  echo "Valid Figma URL"
else
  echo "Not a valid Figma URL"
fi
```

## Extract from Jira/Markdown

Find Figma URLs in text content:

```bash
# From Jira ticket output
extract_figma_urls() {
  grep -oE 'https://(www\.)?figma\.com/(design|file|board|proto)/[^?[:space:]]+' | head -1
}

# Usage with jira CLI
jira issue view POS-2903 --plain | extract_figma_urls
```

## Build API URLs

Helper to construct API URLs from parsed components:

```bash
build_figma_api_url() {
  local endpoint="$1"
  local file_key="$2"
  local params="$3"

  local base="https://api.figma.com/v1"

  case "$endpoint" in
    "file")
      echo "$base/files/$file_key${params:+?$params}"
      ;;
    "nodes")
      echo "$base/files/$file_key/nodes${params:+?$params}"
      ;;
    "images")
      echo "$base/images/$file_key${params:+?$params}"
      ;;
    "components")
      echo "$base/files/$file_key/components"
      ;;
    "styles")
      echo "$base/files/$file_key/styles"
      ;;
    "variables")
      echo "$base/files/$file_key/variables/local"
      ;;
    *)
      echo "Unknown endpoint: $endpoint" >&2
      return 1
      ;;
  esac
}

# Usage
build_figma_api_url "images" "abc123" "ids=1%3A234&format=png&scale=2"
# Output: https://api.figma.com/v1/images/abc123?ids=1%3A234&format=png&scale=2
```
