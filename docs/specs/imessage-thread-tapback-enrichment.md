---
title: "iMessage Thread and Tapback Enrichment"
type: spec
status: planned
updated: 2026-03-20
summary: "Defines thread depth/root tracking and tapback aggregation for enriched iMessage note frontmatter"
related:
  - /Users/nathanvale/.claude/plans/serene-wishing-sun.md
  - docs/specs/imessage-note-contract.md
  - docs/specs/imessage-productivity-integration.md
  - skills/imessage-reader/scripts/lib.ts
---

# iMessage Thread and Tapback Enrichment

## Purpose

Add two enrichment passes to message processing so that saved notes carry thread context and tapback reactions as structured frontmatter. This enables queries like "threads about school" and "messages Melanie loved".

## Thread Depth and Root Tracking

### New Frontmatter Fields

```yaml
thread_depth: 3
thread_root: "p:0/ABC123"
```

| Field | Type | Description |
|-------|------|-------------|
| `thread_depth` | number | 0 = root message, 1 = direct reply, 2+ = nested |
| `thread_root` | string | GUID of the thread root (walk reply_to chain to origin) |

### Computation

After `linkMessageTargets()` resolves `reply_to` references:

1. For each message, walk the `reply_to` chain backward to find the root
2. Count the number of hops to determine depth
3. Cache results to avoid recomputation across messages in the same thread

```typescript
function computeThreadDepthAndRoot(
  messages: ParsedMessageInternal[],
): Map<string, { depth: number; root: string }> {
  const byGuid = new Map<string, ParsedMessageInternal>();
  for (const msg of messages) byGuid.set(msg.guid, msg);

  const cache = new Map<string, { depth: number; root: string }>();

  function walk(
    guid: string,
    visiting = new Set<string>(),
  ): { depth: number; root: string } {
    if (cache.has(guid)) return cache.get(guid)!;
    if (visiting.has(guid)) {
      const result = { depth: 0, root: guid };
      cache.set(guid, result);
      return result;
    }

    const msg = byGuid.get(guid);
    if (!msg?.reply_to || !byGuid.has(msg.reply_to)) {
      const result = { depth: 0, root: guid };
      cache.set(guid, result);
      return result;
    }

    visiting.add(guid);
    const parent = walk(msg.reply_to, visiting);
    visiting.delete(guid);
    const result = { depth: parent.depth + 1, root: parent.root };
    cache.set(guid, result);
    return result;
  }

  for (const msg of messages) walk(msg.guid);
  return cache;
}
```

### Complexity

O(n) per message in the worst case, but chains are typically short (<10 hops). The cache makes the total cost O(n) across all messages in a batch.

### Edge Cases

- Messages with no `reply_to`: depth = 0, root = own GUID
- Messages whose `reply_to` target is outside the current batch: depth = 0, root = own GUID (treat as a root within the visible window)
- Circular references (shouldn't happen, but guard against): break the loop and treat as root

## Tapback Aggregation

### New Frontmatter Field

On the **target** message (the message that received tapbacks):

```yaml
tapbacks:
  - type: "Love"
    from: "Melanie"
    guid: "p:0/XYZ789"
  - type: "Laugh"
    from: "me"
    guid: "p:0/ABC456"
```

| Field | Type | Description |
|-------|------|-------------|
| `tapbacks` | array | List of tapback reactions pointing at this message |
| `tapbacks[].type` | string | Human-readable reaction type |
| `tapbacks[].from` | string | Contact name or "me" |
| `tapbacks[].guid` | string | GUID of the tapback message itself |

### Tapback Type Mapping

| `associated_message_type` | Display Name |
|---------------------------|-------------|
| 2000 | Love |
| 2001 | Like |
| 2002 | Dislike |
| 2003 | Laugh |
| 2004 | Emphasis |
| 2005 | Question |
| 3000 | Remove Love |
| 3001 | Remove Like |
| 3002 | Remove Dislike |
| 3003 | Remove Laugh |
| 3004 | Remove Emphasis |
| 3005 | Remove Question |

Remove tapbacks (3000+) should cancel the corresponding add. If a remove is found for a previously seen add from the same sender and target message, omit both from the final `tapbacks[]` list.

### Computation

After all messages are parsed and linked:

1. Build a map: `target_guid -> TapbackInfo[]`
2. For each tapback message, resolve its `reaction_to` target
3. Look up the sender (contact name or "me")
4. Map the `reaction_type` to a display name
5. Inject the aggregated `tapbacks[]` into the target message's data before saving

```typescript
type TapbackInfo = {
  type: string;
  from: string;
  guid: string;
  actorKey: string;
  timestamp: string;
};

function aggregateTapbacks(
  messages: ParsedMessageInternal[],
  contactMap: Map<string, string>,
): Map<string, TapbackInfo[]> {
  const tapbackMap = new Map<string, TapbackInfo[]>();
  const activeByTarget = new Map<string, Map<string, TapbackInfo>>();

  for (const msg of messages) {
    if (msg.message_kind !== "tapback" || !msg.reaction_to) continue;

    const typeName = tapbackTypeToName(msg.reaction_type);
    if (!typeName) continue;

    const from = msg.is_from_me
      ? "me"
      : (msg.contact_name ?? msg.handle ?? "unknown");
    const actorKey = msg.is_from_me ? "me" : (msg.handle ?? from);
    const targetKey = msg.reaction_to;
    const bucket = activeByTarget.get(targetKey) ?? new Map<string, TapbackInfo>();
    const pairKey = `${actorKey}:${typeName.replace("Remove ", "")}`;

    if (typeName.startsWith("Remove ")) {
      bucket.delete(pairKey);
      activeByTarget.set(targetKey, bucket);
      continue;
    }

    bucket.set(pairKey, {
      type: typeName,
      from,
      guid: msg.guid,
      actorKey,
      timestamp: msg.date_local ?? msg.date ?? "",
    });
    activeByTarget.set(targetKey, bucket);
  }

  for (const [targetKey, bucket] of activeByTarget.entries()) {
    tapbackMap.set(
      targetKey,
      Array.from(bucket.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    );
  }

  return tapbackMap;
}
```

### Integration Point

Call `aggregateTapbacks()` after `linkMessageTargets()` in the query pipeline. Pass the resulting map into `saveMessageAsMarkdown()` so it can write the `tapbacks:` field.

This requires extending the `saveMessageAsMarkdown` signature to accept optional enrichment data:

```typescript
type MessageEnrichment = {
  threadDepth?: number;
  threadRoot?: string;
  tapbacks?: TapbackInfo[];
};

function saveMessageAsMarkdown(
  msg: ParsedMessage,
  saveDir: string,
  enrichment?: MessageEnrichment,
): string | null;
```

## Tapback Persistence Policy

Default sync behavior:
- aggregate tapback reactions onto the target message
- do not save pure tapback events as standalone Markdown notes
- keep tapback-only persistence out of the default QMD-visible message surface to avoid duplicate recall hits

Optional debug mode:
- a future `--include-tapback-notes` flag may export raw tapback events for forensic or migration use
- if implemented, those notes should live outside the default `docs/messages/` surface

## Enrichment CLI Primitive

Agents need a way to enrich already-saved notes without re-running a broad historical query.

Add a dedicated command:

```sh
bun run query-imessage.ts enrich \
  --save-dir ~/code/personal-messages/docs/messages/imessage \
  --source-id p:0/ABC123 \
  --threads \
  --tapbacks
```

Contract:
- targets existing notes by `source_id`, path glob, or time window
- loads only the minimum raw message data needed to compute the requested enrichment
- patches notes in place
- can be re-run safely and idempotently

This primitive also gives agents a stable path for future attachment OCR and Vision enrichment.

## Implementation Target

**File:** `skills/imessage-reader/scripts/lib.ts`

New functions:
- `computeThreadDepthAndRoot()`
- `aggregateTapbacks()`
- `tapbackTypeToName()`

Modified functions:
- `saveMessageAsMarkdown()` -- accept enrichment param, write new fields

**File:** `skills/imessage-reader/scripts/query-imessage.ts`

Modified: call enrichment functions after `linkMessageTargets()`, pass results to save.

## Verification

1. A reply message has `thread_depth: 1` and `thread_root` pointing to the parent
2. A nested reply has `thread_depth: 2+`
3. A root message has `thread_depth: 0` and `thread_root` equal to its own GUID
4. A message with tapbacks has a `tapbacks:` array in frontmatter
5. Tapback types map to correct display names
6. Remove tapbacks (3000+) cancel corresponding adds from the same sender
7. `tapbacks[].from` shows contact name, not raw handle
8. Circular `reply_to` chains do not recurse forever
9. Default sync does not emit standalone Markdown notes for pure tapback events
10. `query-imessage.ts enrich --threads --tapbacks` can patch existing notes without a full-window requery
