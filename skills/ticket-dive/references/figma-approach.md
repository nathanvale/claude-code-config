# Figma Approach: Tier 2 Only

## Why No Image Export

The `ticket-dive` skill deliberately avoids Figma image export (Tier 1 API):

1. **Rate budget** - View/Collab seats get only 6 exports per month. Burning one on a quick ticket read is wasteful.
2. **Speed** - Export is slow (render + download). Tier 2 calls (frames, tokens) return in under a second.
3. **Scope** - This skill gathers context, not visual assets. Design properties (typography, colors, dimensions) are more useful for understanding implementation requirements than a rasterized image.

## What We Use Instead

| Operation | Tier | What It Returns |
|-----------|------|-----------------|
| `frames` | Tier 2 | Frame names, IDs, types - the structure of the design |
| `tokens` | Tier 2 | Typography, colors, dimensions - the design properties |

Both are available regardless of seat type (Dev, Full, View, Collab) and have a 5/min rate limit.

## Manual Viewing

The summary includes the direct Figma URL. Nathan can:
- Open it in a browser for full visual context
- Paste screenshots into the conversation if needed
- Use `/figma:export` explicitly if an image is truly needed

## When Export IS Appropriate

Export belongs in skills that need pixel-level comparison:
- `/figma-compare` - comparing implementation against design
- `/qa-test` - visual regression testing
- `/kickoff` - when seat is `high` (Dev/Full) and budget allows

Those skills handle their own seat detection and budget decisions.
