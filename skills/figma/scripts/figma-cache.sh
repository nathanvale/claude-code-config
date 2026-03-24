#!/bin/bash
# Figma API cache helper - reduces rate limit hits
# Usage: source this file, then use the functions

FIGMA_CACHE_DIR="${FIGMA_CACHE_DIR:-$HOME/.claude/scratch/figma-cache}"
FIGMA_CACHE_TTL_IMAGES="${FIGMA_CACHE_TTL_IMAGES:-3600}"      # 1 hour for images
FIGMA_CACHE_TTL_METADATA="${FIGMA_CACHE_TTL_METADATA:-600}"   # 10 min for file metadata
FIGMA_CACHE_TTL_NODES="${FIGMA_CACHE_TTL_NODES:-1800}"        # 30 min for node data

mkdir -p "$FIGMA_CACHE_DIR"

FIGMA_MAX_RETRIES="${FIGMA_MAX_RETRIES:-2}"
FIGMA_MAX_RETRY_AFTER="${FIGMA_MAX_RETRY_AFTER:-120}"

# Authenticated Figma API request with retry-on-429
# Checks Retry-After header, retries up to FIGMA_MAX_RETRIES times
# Falls through immediately if Retry-After exceeds FIGMA_MAX_RETRY_AFTER (monthly limit exhausted)
# Usage: figma_request <url> [curl_extra_args...]
# Returns: response body on stdout, exit 0 on success, exit 1 on permanent failure
figma_request() {
  local url="$1"
  shift
  local attempt=0

  while [ "$attempt" -le "$FIGMA_MAX_RETRIES" ]; do
    local tmp_headers
    tmp_headers=$(mktemp)

    local response
    response=$(curl -s -D "$tmp_headers" \
      -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
      "$@" "$url")

    local http_status
    http_status=$(grep -i "HTTP/" "$tmp_headers" | tail -1 | awk '{print $2}')

    if [ "$http_status" != "429" ]; then
      rm -f "$tmp_headers"
      echo "$response"
      return 0
    fi

    local retry_after
    retry_after=$(grep -i "retry-after" "$tmp_headers" | awk '{print $2}' | tr -d '\r\n')
    rm -f "$tmp_headers"
    retry_after="${retry_after:-5}"

    if [ "$retry_after" -gt "$FIGMA_MAX_RETRY_AFTER" ] 2>/dev/null; then
      echo "FIGMA_RATE_LIMITED: Retry-After ${retry_after}s exceeds max (${FIGMA_MAX_RETRY_AFTER}s) — monthly limit likely exhausted" >&2
      echo "$response"
      return 1
    fi

    attempt=$((attempt + 1))
    if [ "$attempt" -le "$FIGMA_MAX_RETRIES" ]; then
      local backoff=$((retry_after + attempt))
      echo "FIGMA_RETRY: 429 received, waiting ${backoff}s (attempt $attempt/$FIGMA_MAX_RETRIES)" >&2
      sleep "$backoff"
    fi
  done

  echo "FIGMA_RATE_LIMITED: Exhausted $FIGMA_MAX_RETRIES retries" >&2
  echo "$response"
  return 1
}

# Check if cache file is valid (exists and not expired)
# Usage: cache_valid <cache_file> <ttl_seconds>
cache_valid() {
  local cache_file="$1"
  local ttl="$2"

  if [ ! -f "$cache_file" ]; then
    return 1
  fi

  local age=$(($(date +%s) - $(stat -f %m "$cache_file" 2>/dev/null || stat -c %Y "$cache_file" 2>/dev/null)))
  [ "$age" -lt "$ttl" ]
}

# Get cache path for a given key
# Usage: cache_path <type> <file_key> [node_id]
cache_path() {
  local type="$1"
  local file_key="$2"
  local node_id="${3:-}"

  if [ -n "$node_id" ]; then
    local safe_node=$(echo "$node_id" | sed 's/:/_/g')
    echo "$FIGMA_CACHE_DIR/${type}_${file_key}_${safe_node}"
  else
    echo "$FIGMA_CACHE_DIR/${type}_${file_key}"
  fi
}

# Cached file metadata fetch
# Usage: figma_get_file <file_key> [depth]
figma_get_file() {
  local file_key="$1"
  local depth="${2:-2}"
  local cache_file=$(cache_path "file" "$file_key")
  cache_file="${cache_file}_d${depth}.json"

  if cache_valid "$cache_file" "$FIGMA_CACHE_TTL_METADATA"; then
    cat "$cache_file"
    return 0
  fi

  local response
  if ! response=$(figma_request "https://api.figma.com/v1/files/$file_key?depth=$depth"); then
    echo "$response"
    return 1
  fi

  if echo "$response" | jq -e '.err' > /dev/null 2>&1; then
    echo "$response"
    return 1
  fi

  echo "$response" > "$cache_file"
  cat "$cache_file"
}

# Cached node fetch
# Usage: figma_get_nodes <file_key> <node_ids>
figma_get_nodes() {
  local file_key="$1"
  local node_ids="$2"
  local encoded_ids=$(echo "$node_ids" | sed 's/:/%3A/g')
  local cache_file=$(cache_path "nodes" "$file_key" "$node_ids")
  cache_file="${cache_file}.json"

  if cache_valid "$cache_file" "$FIGMA_CACHE_TTL_NODES"; then
    cat "$cache_file"
    return 0
  fi

  local response
  if ! response=$(figma_request "https://api.figma.com/v1/files/$file_key/nodes?ids=$encoded_ids"); then
    echo "$response"
    return 1
  fi

  if echo "$response" | jq -e '.err' > /dev/null 2>&1; then
    echo "$response"
    return 1
  fi

  echo "$response" > "$cache_file"
  cat "$cache_file"
}

# Cached image export
# Usage: figma_export_image <file_key> <node_id> <output_path> [scale] [format]
figma_export_image() {
  local file_key="$1"
  local node_id="$2"
  local output_path="$3"
  local scale="${4:-2}"
  local format="${5:-png}"
  local encoded_id=$(echo "$node_id" | sed 's/:/%3A/g')
  local cache_file=$(cache_path "image" "$file_key" "$node_id")
  cache_file="${cache_file}_s${scale}.${format}"

  if cache_valid "$cache_file" "$FIGMA_CACHE_TTL_IMAGES"; then
    cp "$cache_file" "$output_path"
    echo "Using cached image: $cache_file"
    return 0
  fi

  local image_response
  if ! image_response=$(figma_request "https://api.figma.com/v1/images/$file_key?ids=$encoded_id&format=$format&scale=$scale"); then
    echo "ERROR: Image export rate limited"
    return 1
  fi

  local image_url
  image_url=$(echo "$image_response" | jq -r ".images[\"$node_id\"]")

  if [ -z "$image_url" ] || [ "$image_url" = "null" ]; then
    echo "ERROR: Failed to get image URL"
    return 1
  fi

  curl -sL "$image_url" -o "$cache_file"
  cp "$cache_file" "$output_path"
  echo "Downloaded and cached: $cache_file"
}

# Clear cache (all or by type)
# Usage: figma_cache_clear [type]
figma_cache_clear() {
  local type="${1:-}"

  if [ -z "$type" ]; then
    rm -rf "$FIGMA_CACHE_DIR"/*
    echo "Cleared all Figma cache"
  else
    rm -f "$FIGMA_CACHE_DIR/${type}_"*
    echo "Cleared $type cache"
  fi
}

# Show cache stats
figma_cache_stats() {
  echo "Cache directory: $FIGMA_CACHE_DIR"
  echo "TTL - Images: ${FIGMA_CACHE_TTL_IMAGES}s, Metadata: ${FIGMA_CACHE_TTL_METADATA}s, Nodes: ${FIGMA_CACHE_TTL_NODES}s"
  echo ""
  if [ -d "$FIGMA_CACHE_DIR" ]; then
    echo "Cached files:"
    ls -lh "$FIGMA_CACHE_DIR" 2>/dev/null | tail -n +2
    echo ""
    echo "Total size: $(du -sh "$FIGMA_CACHE_DIR" 2>/dev/null | cut -f1)"
  else
    echo "No cache directory"
  fi
}
