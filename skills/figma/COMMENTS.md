# Figma Comments API

Post QA feedback and review comments directly to Figma designs.

**Required scope:** `file_comments:write`

## Use Cases

- Post implementation status to Figma after design comparison
- Add automated QA feedback on specific frames
- Reply to designer comments with implementation notes
- Mark designs as "implemented" or "needs review"

## Quick Commands

### List Comments

```bash
curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/comments" | \
  jq '.comments[] | {id, message, user: .user.handle, node: .client_meta.node_id}'
```

### Post Comment on Frame

```bash
curl -X POST \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Implementation complete ✓",
    "client_meta": { "node_id": "'"$NODE_ID"'" }
  }' \
  "https://api.figma.com/v1/files/$FILE_KEY/comments"
```

### Reply to Comment

```bash
PARENT_COMMENT_ID="existing_comment_id"

curl -X POST \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Fixed in PR #123",
    "comment_id": "'"$PARENT_COMMENT_ID"'"
  }' \
  "https://api.figma.com/v1/files/$FILE_KEY/comments"
```

### Delete Comment

```bash
COMMENT_ID="comment_to_delete"

curl -X DELETE \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/comments/$COMMENT_ID"
```

## Workflows

### Post QA Comparison Results

After running figma-compare, post the results back to Figma:

```bash
#!/bin/bash
# post-qa-results.sh

FILE_KEY="$1"
NODE_ID="$2"
STATUS="$3"  # "pass" or "fail"
DETAILS="$4"

if [ "$STATUS" = "pass" ]; then
  MESSAGE="✅ **Implementation Verified**\n\nDesign comparison passed.\n\n$DETAILS"
else
  MESSAGE="⚠️ **Review Required**\n\nDifferences found:\n\n$DETAILS"
fi

curl -X POST \
  -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"$MESSAGE\",
    \"client_meta\": { \"node_id\": \"$NODE_ID\" }
  }" \
  "https://api.figma.com/v1/files/$FILE_KEY/comments"
```

### Batch Post Comments

Post comments to multiple frames:

```bash
#!/bin/bash
# batch-comments.sh

FILE_KEY="$1"
MESSAGE="$2"

# Node IDs to comment on
NODE_IDS=("1:234" "1:235" "1:236")

for NODE_ID in "${NODE_IDS[@]}"; do
  echo "Posting to $NODE_ID..."
  curl -sX POST \
    -H "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
    -H "Content-Type: application/json" \
    -d "{
      \"message\": \"$MESSAGE\",
      \"client_meta\": { \"node_id\": \"$NODE_ID\" }
    }" \
    "https://api.figma.com/v1/files/$FILE_KEY/comments" | jq -r '.id'

  sleep 1  # Rate limit protection
done
```

### Find Unresolved Comments

```bash
curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/comments" | \
  jq '[.comments[] | select(.resolved_at == null)] | {
    count: length,
    comments: [.[] | {id, message: .message[0:50], user: .user.handle}]
  }'
```

### Get Comments for Specific Node

```bash
NODE_ID="1:234"

curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/comments" | \
  jq --arg node "$NODE_ID" '[.comments[] | select(.client_meta.node_id == $node)]'
```

## Comment Templates

### Implementation Status

```bash
# Completed
MESSAGE="✅ **Implemented**\nPR: https://github.com/org/repo/pull/123\nRoute: /path/to/page"

# In Progress
MESSAGE="🚧 **In Progress**\nBranch: feat/POS-1234\nETA: End of sprint"

# Blocked
MESSAGE="🚫 **Blocked**\nReason: Missing design specs for mobile breakpoint"
```

### Design Feedback

```bash
# Clarification needed
MESSAGE="❓ **Clarification Needed**\nWhat should happen when X occurs?"

# Suggestion
MESSAGE="💡 **Suggestion**\nConsider using the existing Button component"
```

### QA Results

```bash
# Pass
MESSAGE="✅ **QA Passed**\n- Layout matches\n- Colors correct\n- Typography verified"

# Fail with details
MESSAGE="⚠️ **QA Issues Found**\n- Font size: Expected 16px, got 14px\n- Color: Expected #333, got #000"
```

## Response Handling

### Parse New Comment ID

```bash
RESPONSE=$(curl -sX POST ...)
COMMENT_ID=$(echo "$RESPONSE" | jq -r '.id')
echo "Created comment: $COMMENT_ID"
```

### Check for Errors

```bash
RESPONSE=$(curl -sX POST ...)
ERROR=$(echo "$RESPONSE" | jq -r '.err // empty')

if [ -n "$ERROR" ]; then
  echo "Error: $ERROR"
  exit 1
fi
```

## Limitations

- Comments cannot be edited after creation (delete and re-post instead)
- Maximum message length: ~10,000 characters
- Rate limit: Tier 2 (see RATE-LIMITS.md)
- Node position (`node_offset`) is optional but helps pin comments precisely

## Integration with figma-compare

The `figma-compare` skill can automatically post comparison results:

1. Run comparison
2. Generate summary of differences
3. Post comment to the compared frame
4. Include links to PR/branch

Example integration point in figma-compare workflow:

```bash
# After comparison is complete
if [ -n "$DIFFERENCES" ]; then
  bash ~/.claude/skills/figma/scripts/post-qa-results.sh \
    "$FILE_KEY" "$NODE_ID" "fail" "$DIFFERENCES"
else
  bash ~/.claude/skills/figma/scripts/post-qa-results.sh \
    "$FILE_KEY" "$NODE_ID" "pass" "All checks passed"
fi
```
