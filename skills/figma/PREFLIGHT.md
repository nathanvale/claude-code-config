# Figma Pre-flight

Run these steps at the start of every figma building block invocation. They validate the token, parse the URL, and detect the seat type — providing shared context for all operations.

## Step 1: Source Cache Helper

```bash
source ~/.claude/skills/figma/scripts/figma-cache.sh
```

## Step 2: Validate Token (Tier 3)

```bash
if [ -z "$(printenv FIGMA_TOKEN)" ]; then
  echo "PREFLIGHT FAILED: FIGMA_TOKEN not set"
  echo "Generate at: Figma → Settings → Security → Personal access tokens"
  echo "Add to ~/.zshrc: export FIGMA_TOKEN=\"figd_xxx...\""
  # Output structured result and stop
fi

ME_RESPONSE=$(curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" "https://api.figma.com/v1/me")
USER_NAME=$(echo "$ME_RESPONSE" | jq -r '.handle // empty')

if [ -z "$USER_NAME" ]; then
  echo "PREFLIGHT FAILED: Token invalid or expired"
  echo "Regenerate at: Figma → Settings → Security → Personal access tokens"
  # Output structured result and stop
fi
```

## Step 3: Parse URL

```bash
FIGMA_URL="<from arguments>"
FILE_KEY=$(echo "$FIGMA_URL" | grep -oE '(design|file|board|proto)/[^/?]+' | cut -d'/' -f2)
NODE_ID=$(echo "$FIGMA_URL" | grep -oE 'node-id=[^&]+' | cut -d'=' -f2 | sed 's/%3A/:/g')

if [ -z "$FILE_KEY" ]; then
  echo "PREFLIGHT FAILED: Could not extract file key from URL"
  echo "Expected format: https://www.figma.com/design/<FILE_KEY>/..."
  # Output structured result and stop
fi
```

**URL formats supported:**
- `https://www.figma.com/design/[KEY]/[NAME]`
- `https://www.figma.com/file/[KEY]/[NAME]`
- `https://www.figma.com/board/[KEY]/[NAME]`
- `https://www.figma.com/proto/[KEY]/[NAME]`
- Any of the above with `?node-id=X:Y` or `?node-id=X%3AY`

## Step 4: Detect Seat Type (Tier 2)

```bash
RESPONSE=$(curl -sI -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY?depth=1")

HTTP_STATUS=$(echo "$RESPONSE" | grep -i "HTTP/" | awk '{print $2}')
RATE_TYPE=$(echo "$RESPONSE" | grep -i "x-figma-rate-limit-type" | awk '{print $2}' | tr -d '\r\n')
RETRY_AFTER=$(echo "$RESPONSE" | grep -i "retry-after" | awk '{print $2}' | tr -d '\r\n')
```

**Interpret results:**

| HTTP Status | Rate Type | Meaning | `can_export` |
|-------------|-----------|---------|-------------|
| 200 | `high` | Dev/Full seat | true |
| 200 | `low` | View/Collab seat (6 Tier 1 exports/month) | false |
| 429 | — | Tier 2 rate limited | false |
| 403 | — | No access to this file | false |
| 404 | — | File not found | false |

## Step 5: Output Pre-flight Status

Output the structured pre-flight block that all operations include:

```
### Pre-flight
- Token: valid (<USER_NAME>)
- Seat: <high|low|rate_limited|no_access|not_found>
- File key: <FILE_KEY>
- Node ID: <NODE_ID or "none">
```

### Tier Availability

After seat detection, output a structured tier availability block so callers know which API tiers are safe to use:

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

**Fallback recommendation:**
- `high` seat → `"none"` (all tiers available)
- `low` seat → `"tokens"` (use Tier 2 token extraction instead of Tier 1 image export)
- `rate_limited` → `"browser"` (Tier 2 also exhausted, use browser screenshot)
- `no_access` → `"browser"` (no API access at all)

If the operation is `preflight`, stop here. Otherwise, proceed to the requested operation in [OPERATIONS.md](OPERATIONS.md).
