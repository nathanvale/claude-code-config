# Figma Operations

Implementation details for each operation. All operations assume [PREFLIGHT.md](PREFLIGHT.md) has already run and set: `FILE_KEY`, `NODE_ID`, `RATE_TYPE`, `USER_NAME`.

## frames

List top-level frames in the file. Optionally filter by keywords.

**Tier:** 2 | **Low seat:** Yes

```bash
FRAME_DATA=$(figma_get_file "$FILE_KEY" 2)

if echo "$FRAME_DATA" | jq -e '.err' > /dev/null 2>&1; then
  echo "ERROR: $(echo "$FRAME_DATA" | jq -r '.err')"
  # Output status: failed
fi

# Extract frames
echo "$FRAME_DATA" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for page in data['document']['children']:
    for child in page.get('children', []):
        print(f'{child[\"id\"]}\t{child[\"name\"]}\t{child[\"type\"]}')
"
```

**With `--keywords`:** Filter output to frames whose names contain any of the keywords (case-insensitive).

```bash
# Example: --keywords "bulk print,create order"
echo "$FRAME_DATA" | python3 -c "
import sys, json
keywords = '$KEYWORDS'.lower().split(',')
data = json.load(sys.stdin)
for page in data['document']['children']:
    for child in page.get('children', []):
        name_lower = child['name'].lower()
        if any(k.strip() in name_lower for k in keywords):
            print(f'{child[\"id\"]}\t{child[\"name\"]}\t{child[\"type\"]}')
"
```

**Result format:**

```
### Result
| ID | Name | Type |
|----|------|------|
| 1:234 | Create Order | FRAME |
| 1:567 | Order List | FRAME |

### Context for Caller
- file_key: <key>
- seat_type: <high|low>
- can_export: <true|false>
- frame_count: <N>
- frame_ids: <comma-separated>
```

---

## export

Export node(s) as image. **Guarded on low seats.**

**Tier:** 1 | **Low seat:** Refused

```bash
# Seat guard
if [ "$RATE_TYPE" = "low" ]; then
  echo "View/Collab seat — export skipped to preserve Tier 1 budget (6/month)."
  echo "Use Figma app to manually export, or upgrade to Dev/Full seat."
  # Output status: partial with can_export: false
fi

# Determine node(s) to export
EXPORT_IDS="${NODE_IDS:-$NODE_ID}"
if [ -z "$EXPORT_IDS" ]; then
  echo "ERROR: --node-id or --node-ids required for export"
  # Output status: failed
fi

SCALE="${SCALE:-2}"
FORMAT="${FORMAT:-png}"
OUTPUT_DIR="${OUTPUT_DIR:-$(pwd)}"
mkdir -p "$OUTPUT_DIR"

# Export each node (uses cache)
for NID in $(echo "$EXPORT_IDS" | tr ',' ' '); do
  SAFE_NAME=$(echo "$NID" | sed 's/:/_/g')
  OUTPUT_PATH="$OUTPUT_DIR/figma-${SAFE_NAME}.${FORMAT}"
  figma_export_image "$FILE_KEY" "$NID" "$OUTPUT_PATH" "$SCALE" "$FORMAT"
done
```

### Fallback: Automatic Token Extraction

If export is refused (low seat) or fails (429), automatically fall back to Tier 2 token extraction on the same node(s). This gives callers structured design data even without images.

```
export refused/fails → try tokens on same node ID(s) → return partial result with properties
```

When the seat guard blocks export OR a 429 is returned:
1. For each node in `EXPORT_IDS`, run `figma_get_nodes "$FILE_KEY" "$NID"` (Tier 2)
2. Extract typography, colors, and dimensions (same jq patterns as `tokens` operation)
3. Output a partial result with `fallback: "tokens"` in the Context for Caller

If token extraction also fails (Tier 2 rate limited), output `status: failed` with `recommended_fallback: "browser"`.

**Result format (success):**

```
### Result
Exported <N> node(s):
- figma-1_234.png → <output_dir>/figma-1_234.png

### Context for Caller
- file_key: <key>
- exported_paths: <comma-separated paths>
- format: <png|svg|pdf|jpg>
- scale: <N>
```

**Result format (fallback to tokens):**

```
### Result
Export unavailable — extracted design tokens as fallback.

#### Typography
| Element | Font | Size | Weight |
|---------|------|------|--------|

#### Colors
| Color | CSS |
|-------|-----|

#### Dimensions
| Element | W × H |
|---------|-------|

### Context for Caller
- file_key: <key>
- status: partial
- fallback: tokens
- design_properties: { text_nodes: [...], colors: [...], dimensions: [...] }
- can_export: false
- recommended_fallback: browser
```

---

## tokens

Extract design tokens from a node's subtree.

**Tier:** 2 | **Low seat:** Yes

```bash
TARGET_ID="${NODE_ID}"
if [ -z "$TARGET_ID" ]; then
  echo "ERROR: --node-id required for tokens extraction"
fi

NODE_DATA=$(figma_get_nodes "$FILE_KEY" "$TARGET_ID")

# Typography
echo "$NODE_DATA" | jq '[.. | objects | select(.type == "TEXT") | {
  name, text: .characters, font: .style.fontFamily,
  size: .style.fontSize, weight: .style.fontWeight,
  lineHeight: .style.lineHeightPx, letterSpacing: .style.letterSpacing
}]'

# Colors (convert Figma 0-1 to CSS 0-255)
echo "$NODE_DATA" | jq '[.. | objects | select(.fills?) |
  .fills[] | select(.type == "SOLID") | .color |
  "rgb(\((.r * 255) | round), \((.g * 255) | round), \((.b * 255) | round))"
] | unique'

# Dimensions
echo "$NODE_DATA" | jq '[.. | objects | select(.absoluteBoundingBox?) | {
  name, type,
  width: .absoluteBoundingBox.width,
  height: .absoluteBoundingBox.height
}]'
```

**Result format:**

```
### Result
#### Typography
| Element | Font | Size | Weight |
|---------|------|------|--------|
| Heading | Inter | 24 | 700 |

#### Colors
| Color | CSS |
|-------|-----|
| Primary | rgb(0, 102, 204) |

#### Dimensions
| Element | W × H |
|---------|-------|
| Card | 320 × 240 |

### Context for Caller
- file_key: <key>
- node_id: <id>
- token_types: typography,colors,dimensions
```

---

## variables

Get design variables (Enterprise feature).

**Tier:** 2 | **Low seat:** Yes

```bash
VARS_RESPONSE=$(curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/variables/local")

if echo "$VARS_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "Variables not available (may require Enterprise plan)"
fi

echo "$VARS_RESPONSE" | jq '.meta.variables | to_entries[] | {
  name: .value.name,
  type: .value.resolvedType,
  values: [.value.valuesByMode | to_entries[] | .value]
}'
```

**Result format:**

```
### Result
| Variable | Type | Values |
|----------|------|--------|
| spacing-sm | FLOAT | [8] |
| color-primary | COLOR | [{r:0,g:0.4,b:0.8,a:1}] |

### Context for Caller
- file_key: <key>
- variable_count: <N>
```

---

## comment

Post a comment to a file, optionally pinned to a node.

**Tier:** 2 | **Low seat:** Yes

```bash
MESSAGE="${MESSAGE}"
if [ -z "$MESSAGE" ]; then
  echo "ERROR: --message required for comment operation"
fi

COMMENT_BODY="{\"message\": \"$MESSAGE\""
if [ -n "$NODE_ID" ]; then
  COMMENT_BODY="$COMMENT_BODY, \"client_meta\": {\"node_id\": \"$NODE_ID\"}"
fi
COMMENT_BODY="$COMMENT_BODY}"

curl -X POST \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  -H "Content-Type: application/json" \
  -d "$COMMENT_BODY" \
  "https://api.figma.com/v1/files/$FILE_KEY/comments"
```

See [COMMENTS.md](COMMENTS.md) for advanced comment workflows (reply threads, resolution).

**Result format:**

```
### Result
Comment posted successfully.
- Comment ID: <id>
- Node: <node_id or "file-level">

### Context for Caller
- file_key: <key>
- comment_id: <id>
```

---

## link

Create a dev resource linking code to a design node.

**Tier:** 2 | **Low seat:** Yes

```bash
CODE_URL="${CODE_URL}"
if [ -z "$CODE_URL" ]; then
  echo "ERROR: --code-url required for link operation"
fi

TARGET_ID="${NODE_ID}"
if [ -z "$TARGET_ID" ]; then
  echo "ERROR: --node-id required for link operation"
fi

LINK_NAME=$(basename "$CODE_URL")

curl -X POST \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  -H "Content-Type: application/json" \
  -d "{
    \"dev_resources\": [{
      \"name\": \"$LINK_NAME\",
      \"url\": \"$CODE_URL\",
      \"node_id\": \"$TARGET_ID\"
    }]
  }" \
  "https://api.figma.com/v1/files/$FILE_KEY/dev_resources"
```

See [DEV-RESOURCES.md](DEV-RESOURCES.md) for advanced linking workflows.

**Result format:**

```
### Result
Dev resource linked.
- Name: <link_name>
- Code: <code_url>
- Node: <node_id>

### Context for Caller
- file_key: <key>
- linked_node: <node_id>
- code_url: <url>
```
