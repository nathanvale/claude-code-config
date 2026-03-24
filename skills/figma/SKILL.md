---
name: figma
description: Figma REST API building block. Token validation, seat detection, frame listing, image export, design tokens, comments, dev resource linking. Composes into workflow skills.
allowed-tools: Bash, Read, Glob
context: fork
model: haiku
user-invocable: false
argument-hint: <operation> <figma-url> [options]
---

# Task

Execute a Figma API operation with pre-flight validation. Your arguments:

- **Operation:** `$0`
- **URL:** `$1`
- **All args:** `$ARGUMENTS`

**IMPORTANT — Shell Expansion:** Always use `$(printenv FIGMA_TOKEN)` in curl headers, **never** `$FIGMA_TOKEN`. Direct variable expansion silently fails in the Bash sandbox.

Execute all steps below in order. Output the structured result at the end.

---

## Step 1: Source cache helper

Run:
```bash
source ~/.claude/skills/figma/scripts/figma-cache.sh && echo "CACHE_OK"
```

If this fails, output status: failed and stop.

## Step 2: Check token exists

Run:
```bash
printenv FIGMA_TOKEN | head -c 10
```

If output is empty, output this and stop:
```
## Figma: $0
### Pre-flight
- Token: MISSING
- Status: failed
- Hint: Generate at Figma → Settings → Security → Personal access tokens. Add to ~/.zshrc: export FIGMA_TOKEN="figd_xxx..."
```

## Step 3: Validate token

Run:
```bash
curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" "https://api.figma.com/v1/me" | jq -r '.handle // "INVALID"'
```

If output is "INVALID" or empty, output this and stop:
```
## Figma: $0
### Pre-flight
- Token: INVALID
- Status: failed
- Hint: Regenerate at Figma → Settings → Security → Personal access tokens
```

Save the output as `USER_NAME` for the structured result.

## Step 4: Parse URL

Run:
```bash
echo "$1" | grep -oE '(design|file|board|proto)/[^/?]+' | cut -d'/' -f2
```

Save output as `FILE_KEY`. If empty, output "Could not extract file key from URL" and stop.

Then check for a node ID:
```bash
echo "$1" | grep -oE 'node-id=[^&]+' | cut -d'=' -f2 | sed 's/%3A/:/g'
```

Save output as `NODE_ID` (may be empty — that's OK).

## Step 5: Detect seat type (Tier 2)

Run:
```bash
curl -sI -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" "https://api.figma.com/v1/files/FILE_KEY?depth=1"
```

(Replace `FILE_KEY` with the value from Step 4.)

From the response headers, extract:
- **HTTP status** from the `HTTP/` line (200, 403, 404, 429)
- **Rate type** from the `x-figma-rate-limit-type` header (`high` or `low`)
- **Retry-After** from the `retry-after` header (if 429)

Interpret:
- 200 + `high` → Dev/Full seat. `can_export=true`.
- 200 + `low` → View/Collab seat. `can_export=false`.
- 429 → Tier 2 rate limited. `can_export=false`.
- 403 → No access. `can_export=false`.
- 404 → File not found. `can_export=false`.

### Tier Availability

Based on seat detection, build a tier availability map for callers:

| Seat | Tier 1 (export) | Tier 2 (nodes/files) | Tier 3 (users/comments) |
|------|----------------|---------------------|------------------------|
| `high` | Available (unlimited) | Available (5/min) | Available (10/min) |
| `low` | Blocked (6/month budget) | Available (5/min) | Available (10/min) |
| `rate_limited` | Unavailable | Unavailable (retry) | Available (10/min) |
| `no_access` | Unavailable | Unavailable | Unavailable |

When seat is `low`, set `recommended_fallback: "tokens"` — callers should use Tier 2 token extraction instead of image export.

## Step 6: Output pre-flight status

Output:
```
## Figma: $0

### Pre-flight
- Token: valid (USER_NAME)
- Seat: high|low|rate_limited|no_access|not_found
- File key: FILE_KEY
- Node ID: NODE_ID or "none"
```

If the operation is `preflight`, also output the Context for Caller and stop:
```
### Context for Caller
- file_key: FILE_KEY
- seat_type: high|low|rate_limited
- can_export: true|false

### Tier Availability
```json
{
  "seat_type": "<high|low|rate_limited|no_access>",
  "tiers": {
    "tier1": { "available": <true|false>, "reason": "<reason if unavailable>", "retry_after": <seconds|null> },
    "tier2": { "available": <true|false>, "budget": "5/min", "note": "Node properties, tokens, file reads" },
    "tier3": { "available": <true|false>, "budget": "10/min", "note": "User info, comments" }
  },
  "recommended_fallback": "<tokens|browser|none>"
}
```
```

---

## Step 7: Execute the operation

Based on `$0`, run the matching operation below. Parse `--flag value` pairs from remaining args.

### If operation is `frames`

List top-level frames. Optional: `--keywords` for filtering (comma-separated).

Run:
```bash
source ~/.claude/skills/figma/scripts/figma-cache.sh && figma_get_file "FILE_KEY" 2
```

(Replace FILE_KEY with actual value.)

Parse the JSON output with python3 to extract frames:
```bash
echo 'JSON_HERE' | python3 -c "
import sys, json
data = json.load(sys.stdin)
for page in data['document']['children']:
    for child in page.get('children', []):
        print(f'{child[\"id\"]}\t{child[\"name\"]}\t{child[\"type\"]}')
"
```

If `--keywords` was provided, filter frames whose names match any keyword (case-insensitive).

Output as a markdown table, then:
```
### Context for Caller
- file_key: FILE_KEY
- seat_type: SEAT
- can_export: true|false
- frame_count: N
- frame_ids: comma-separated IDs
```

### If operation is `export`

**REFUSE if seat is `low`** — output "View/Collab seat — export skipped to preserve Tier 1 budget (6/month)." with `can_export: false` and stop.

Requires `--node-id` or `--node-ids`. Optional: `--scale` (default 2), `--format` (default png), `--output-dir`.

Run:
```bash
source ~/.claude/skills/figma/scripts/figma-cache.sh && figma_export_image "FILE_KEY" "NODE_ID" "OUTPUT_PATH" SCALE FORMAT
```

Output exported paths, then Context for Caller.

### If operation is `tokens`

Extract design tokens. Requires `--node-id`.

Run:
```bash
source ~/.claude/skills/figma/scripts/figma-cache.sh && figma_get_nodes "FILE_KEY" "NODE_ID"
```

Then extract from the JSON:
- **Typography:** `jq '[.. | objects | select(.type == "TEXT") | {name, text: .characters, font: .style.fontFamily, size: .style.fontSize, weight: .style.fontWeight}]'`
- **Colors:** `jq '[.. | objects | select(.fills?) | .fills[] | select(.type == "SOLID") | .color | "rgb(\((.r*255)|round), \((.g*255)|round), \((.b*255)|round))"] | unique'`
- **Dimensions:** `jq '[.. | objects | select(.absoluteBoundingBox?) | {name, type, width: .absoluteBoundingBox.width, height: .absoluteBoundingBox.height}]'`

Output as markdown tables, then Context for Caller.

### If operation is `variables`

Run:
```bash
curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" "https://api.figma.com/v1/files/FILE_KEY/variables/local"
```

Extract with jq: `.meta.variables | to_entries[] | {name: .value.name, type: .value.resolvedType}`

### If operation is `comment`

Requires `--message`. Optional: `--node-id`.

Run:
```bash
curl -X POST -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" -H "Content-Type: application/json" -d '{"message": "MESSAGE_HERE"}' "https://api.figma.com/v1/files/FILE_KEY/comments"
```

If `--node-id` provided, add `"client_meta": {"node_id": "NODE_ID"}` to the JSON body.

### If operation is `link`

Requires `--code-url` and `--node-id`.

Run:
```bash
curl -X POST -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" -H "Content-Type: application/json" -d '{"dev_resources": [{"name": "BASENAME", "url": "CODE_URL", "node_id": "NODE_ID"}]}' "https://api.figma.com/v1/files/FILE_KEY/dev_resources"
```

---

## Error handling

For ANY API error:
- **429** → "Rate limited." Include `retry_after` if available.
- **403** → "No access to this file."
- **404** → "File not found."

Always include `### Context for Caller` even on errors, with `status: failed` or `status: rate_limited`.

## Reference docs

If you need deeper details for an operation, use the Read tool on these files:
- `~/.claude/skills/figma/ENDPOINTS.md` — Full API reference
- `~/.claude/skills/figma/RATE-LIMITS.md` — Quotas
- `~/.claude/skills/figma/DATA-EXTRACTION.md` — jq patterns
- `~/.claude/skills/figma/COMMENTS.md` — Comment workflows
- `~/.claude/skills/figma/DEV-RESOURCES.md` — Code linking
