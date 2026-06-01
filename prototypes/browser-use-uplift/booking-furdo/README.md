# PROTOTYPE — real booking flow: capture → save JSON → COLD replay (throwaway)

**Question:** Can we capture a real-world booking flow (Urban Furdo pet
grooming), save it as Recorder JSON, and replay it COLD (fresh browser from
nothing) so it works up to — but not including — the "Book Now" button?

**Answer: YES. Proven live 2026-05-30.**

## What it proves

Captured a genuine grooming booking on `urbanfurdo.com.au/book-now` (which hands
off to a real Square Appointments flow), saved it as `flow.json` (real URLs +
the `.service-row` selector), then COLD-replayed it:

```
COLD start (0 Chrome processes) → fresh warm Chrome launched
  ▶ navigate  urbanfurdo.com.au/book-now
  ▶ navigate  Square booking services page
  ▶ click     .service-row   → advanced to /services/<real-service-id>
  ✓ on the Square booking flow, booking step content present
  ✓ Book Now NOT clicked
```

The `.service-row` click resolved to a real service and **advanced the URL into
the service step** on cold replay — the flow genuinely progressed, not just
loaded pages.

## Safety

- Replays the booking PATH only. The final date/time pick + Book Now confirmation
  are deliberately omitted from `flow.json` — **no real appointment is ever
  created.**
- Values (if any) would be shape-only per Gate 1.

## Run

```
# needs a warm Chrome on $PORT (default 9444) — see ../warm-connect-WORKING.sh
bun prototypes/browser-use-uplift/booking-furdo/cold-replay-booking.ts
```

## Significance

This is the real-world capstone of the capture→store→replay pipeline:
agent-browser captured a live commercial booking flow, it stored as valid
Recorder JSON, and `@puppeteer/replay` played it back from a cold browser against
the live site — stopping safely before the irreversible action. The whole
browser-use → durable-memory → replay loop works on a real booking.

## Throwaway

Delete or fold the validated capture→replay contract into the
`browser-domain-memory` design once decided.
