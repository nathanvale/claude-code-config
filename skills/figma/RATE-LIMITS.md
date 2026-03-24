# Figma API Rate Limits

Rate limits are **per-minute** unless otherwise specified.

> **Updated November 17, 2025** - See [Figma announcement](https://developers.figma.com/docs/updates-to-figmas-developer-platform/)

## How Long Do Rate Limits Last?

Figma uses a **leaky bucket algorithm**, not a fixed reset window:

- **Capacity refills gradually** over 1 minute, not all at once
- **No fixed reset time** - you don't wait for a specific moment
- **`Retry-After` header** - when rate limited (429), this tells you exactly how many seconds to wait
- **Exception**: Tier 1 for View/Collab seats is **per-month** (6 requests/month)

**In practice**: Just respect the `Retry-After` value in 429 responses. The bucket refills continuously, so you may be able to retry sooner than a full minute.

## Limits by Seat Type

### Personal Access Tokens

Limits tracked per-user, per-plan (shared across all requests).

| Tier | View/Collab Seats | Dev/Full Seats (Starter) | Dev/Full (Pro) | Dev/Full (Enterprise) |
|------|-------------------|--------------------------|----------------|----------------------|
| **Tier 1** | 6/month | 10/min | 15/min | 20/min |
| **Tier 2** | 5/min | 25/min | 50/min | 100/min |
| **Tier 3** | 10/min | 50/min | 100/min | 150/min |

### OAuth Apps

Each app gets independent rate limit budgets per user per plan.

## Endpoint Tiers

### Tier 1 (Most Restrictive)

Heavy operations - use sparingly:
- `GET /v1/images/:key` - Render images
- `POST /v1/files/:key/variables` - Modify variables
- Any write operations

### Tier 2 (Standard)

Common read operations:
- `GET /v1/files/:key` - Get file
- `GET /v1/files/:key/nodes` - Get nodes
- `GET /v1/files/:key/components` - List components
- `GET /v1/files/:key/styles` - List styles
- `GET /v1/files/:key/variables/local` - Get variables
- `POST /v1/files/:key/comments` - Post comments

### Tier 3 (Least Restrictive)

Light operations:
- `GET /v1/me` - Current user
- `GET /v1/files/:key/comments` - List comments
- `GET /v1/teams/:id/projects` - List projects
- `GET /v1/webhooks` - List webhooks

## Rate Limit Headers

When rate limited (429), check these headers:

| Header | Description |
|--------|-------------|
| `Retry-After` | **Seconds to wait** before retrying (integer) |
| `X-Figma-Plan-Tier` | Plan tier: `enterprise`, `org`, `pro`, `starter`, `student` |
| `X-Figma-Rate-Limit-Type` | `low` (View/Collab) or `high` (Full/Dev) |
| `X-Figma-Upgrade-Link` | URL to upgrade plan or seat |

## Best Practices for AI Agents

### 1. Cache Aggressively

```bash
CACHE_DIR=~/.claude/scratch/figma-cache
mkdir -p "$CACHE_DIR"

# Cache file structure (valid for hours)
CACHE_FILE="$CACHE_DIR/${FILE_KEY}_structure.json"
if [ ! -f "$CACHE_FILE" ] || [ $(find "$CACHE_FILE" -mmin +60 -print) ]; then
  curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
    "https://api.figma.com/v1/files/$FILE_KEY?depth=2" > "$CACHE_FILE"
fi
```

### 2. Batch Node Requests

```bash
# BAD: Multiple requests
curl ... "/files/$KEY/nodes?ids=1:5"
curl ... "/files/$KEY/nodes?ids=1:6"
curl ... "/files/$KEY/nodes?ids=1:7"

# GOOD: Single batched request
curl ... "/files/$KEY/nodes?ids=1:5,1:6,1:7"
```

### 3. Use Shallow Depth

```bash
# BAD: Full document tree
curl ... "/files/$KEY"

# GOOD: Limited depth for structure discovery
curl ... "/files/$KEY?depth=2"

# BETTER: Only specific nodes when you know IDs
curl ... "/files/$KEY/nodes?ids=$NODE_ID"
```

### 4. Implement Exponential Backoff

```bash
retry_with_backoff() {
  local max_attempts=3
  local attempt=1
  local delay=5

  while [ $attempt -le $max_attempts ]; do
    response=$(curl -sI -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" "$1")
    status=$(echo "$response" | grep -i "HTTP/" | awk '{print $2}')

    if [ "$status" = "429" ]; then
      retry_after=$(echo "$response" | grep -i "Retry-After" | awk '{print $2}')
      delay=${retry_after:-$delay}
      echo "Rate limited. Waiting ${delay}s (attempt $attempt/$max_attempts)"
      sleep $delay
      delay=$((delay * 2))
      attempt=$((attempt + 1))
    else
      curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" "$1"
      return 0
    fi
  done

  echo "Max retries exceeded"
  return 1
}
```

### 5. Reduce Image Scale

```bash
# Development/preview: scale=1
curl ... "/images/$KEY?ids=$ID&scale=1&format=png"

# Production/comparison: scale=2
curl ... "/images/$KEY?ids=$ID&scale=2&format=png"
```

### 6. Use Conditional Requests

Check file version before fetching full content:

```bash
# Get version first (Tier 3, cheap)
VERSION=$(curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY?depth=1" | \
  jq -r '.version')

# Compare with cached version
if [ "$VERSION" != "$CACHED_VERSION" ]; then
  # Fetch full content only if changed
  curl ... "/files/$KEY"
fi
```

## Recovery Strategies

### When Rate Limited

1. **Check `Retry-After` header** - Wait that many seconds
2. **Reduce request frequency** - Add delays between calls
3. **Use cached data** - Serve from cache while waiting
4. **Batch remaining requests** - Combine into fewer calls

### Monitoring Usage

```bash
# Log request timestamps
echo "$(date +%s) $ENDPOINT" >> ~/.claude/scratch/figma-requests.log

# Check recent request count
RECENT=$(awk -v cutoff=$(($(date +%s) - 60)) '$1 > cutoff' \
  ~/.claude/scratch/figma-requests.log | wc -l)
echo "Requests in last minute: $RECENT"
```
