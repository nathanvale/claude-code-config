# Comment style

The voice for every comment this skill posts. Goal: read like a teammate already on the PR, not a review bot dropped in.

## Match the room

Before drafting, read the PR's existing comments (`pr-comments <PR#>`). Mirror their length, tone, and formatting. On most Bitbucket PRs that means short plain sentences, often a question. Real examples from a live thread:

- "Is this meant to be `&&` ?"
- "I think it's meant to be `||` so we can debug the production build, if I understand it correctly @person"
- "@person Otherwise the rest looks okay, if you can confirm this one."

That is the bar. Your comments should not look heavier than these.

## Rules

- **Plain sentences.** No `**P1 —**` headers, no severity badges, no `### Section` scaffolding inside a comment.
- **One short paragraph per inline comment.** State the issue, why it bites, and the suggested direction. Stop.
- **End soft.** A question or light suggestion, not a mandate: "Could we ... instead?", "Worth settling before ...?", "Would it work to ...?"
- **Inline code spans** for symbols (`actionsDisabled`, `safeParse`). A fenced block only when a 2-3 line snippet genuinely clarifies the fix. Never stack multiple blocks in one comment.
- **No em/en-dashes.** Use commas, parens, or rephrase.
- **No padding.** Skip "Great work!" filler, but keep genuine, specific praise in the summary where earned.
- **Resolve, don't re-litigate.** If the review settles an existing debate, reply on that thread plainly; don't open a new finding.

## Inline: before and after

Bot-flavoured (do not post):

> **P1 — status override can re-arm actions against an already-actioned request**
>
> The mutation payload is clean: `handleReview` builds `{ requestId, action, comment }` ...
> [three paragraphs, two code blocks, a "Suggested direction" heading]

Human (post this):

> `isReadOnly` comes off the overridden `detail`, so overriding an APPROVED/DECLINED request back to PENDING re-arms Approve/Decline against an already-actioned request. Harmless while the placeholder guard throws, but live once `ENABLE_REAL_STAFF_API` is on and Mock Data is off. Could we gate `actionsDisabled` on `apiDetail.status` instead, so the override stays presentation-only?

Another:

> This parses the bare object, but `submitLeave` validates a `{ status, success, data }` envelope and the mock previews here use `{ status: 200, data }` too. If the real endpoint comes back enveloped, `safeParse` rejects every response. Worth settling the convention before there's a live endpoint to test against?

## Summary comment shape

One comment, scannable, same terse voice. Order:

1. **Opener (1-2 sentences).** Specific, earned praise. Name a real thing that's good (test coverage of error paths, a faithful type conversion, a correct cache key). No generic "nice PR".
2. **The things to look at (the P0/P1s).** One line each, naming the finding and pointing to its inline comment. Not the full argument; that's inline.
3. **Non-blockers.** A tight bullet list, each bullet one terse sentence in the same voice. These are optional pickups, say so.
4. **Resolved debates** (if any), one or two sentences, e.g. confirming an operator's choice with the reason.
5. **Close.** One warm line. "Happy to talk through any of it."

Keep the whole thing shorter than a reader expects. If it reads like a generated report, cut it down.

## Non-blocker bullet examples

These are the right grain and voice for the summary's non-blocker list:

- No timeout/AbortController on the real Ethos calls, even though `staffApi.ts` says it mirrors `submitLeave.ts` (which has a 30s timeout). A hung endpoint would wedge the query with no recovery.
- The 503 placeholder guard throws synchronously, so React Query retries it 3x and `console.error` fires ~4x per page view. `retry: false` would quiet it.
- `TODO(E2G-XXX)` in two files has unfilled ticket numbers; the sibling uses a real one. Worth backfilling so the follow-up is trackable.
- `buildDetailMockResponse` is the one untested bit of testable logic in the panel; a couple of unit tests would lock in the override-mirroring behaviour.
