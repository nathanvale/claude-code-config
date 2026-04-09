---
name: classic-cinema
description: "Browse movies and generate ticket-style confirmation emails for Classic Cinemas Elsternwick. Use when Nathan asks what's on at the cinema, wants movie details, or wants to 'book tickets'. Generates a personal reminder email — does NOT purchase tickets."
argument-hint: "[movie] [time] [tickets] [zone]"
allowed-tools: Bash, Read, AskUserQuestion, Write
---

# Classic Cinema

Personal reminder-email generator for Classic Cinemas Elsternwick. Walks a conversational booking flow, generates a ticket-style HTML email, and sends it via `gog`. Does NOT purchase tickets or reserve seats — Nathan buys at the box office.

## Intent Classification

Classify and proceed. Do NOT show a mode menu unless intent is genuinely ambiguous.

| Signal | Mode | Action |
|--------|------|--------|
| Args with movie name or time | Express | Parse args ([arg-parsing.md](references/arg-parsing.md)), proceed |
| "what's on", "what's showing", no movie | Browse | Show listing |
| Movie name only, no time | Express | Show that movie's sessions, ask which |
| Ambiguous | Fallback | "🎬 Quick pick or browse what's on?" |

## Express Mode (3 questions max)

Parse args right-to-left: zone → tickets → time → movie remainder. See [arg-parsing.md](references/arg-parsing.md).

1. **Movie + session** — fuzzy match, show sessions with availability emoji
2. **Tickets** — "1+1" = 1 adult + 1 child. Default: 1 adult
3. **Seats** — zone picker or full map (see Availability UX below)

Best case: `/classic-cinema faraway 10am 1+1 middle` → zero questions → confirm → send.

Full choreography in [booking-flow.md](references/booking-flow.md).

## Browse Mode

1. Fetch movie listing via API (instant)
2. Nathan picks a movie → show sessions with availability emoji
3. Nathan picks a session → converge with Express at Q2 (Tickets)

Full choreography in [booking-flow.md](references/booking-flow.md).

## Availability UX

| % Available | Emoji | Label | Seat behavior |
|-------------|-------|-------|---------------|
| 51-100% | 🟢 | plenty available | Zone picker |
| 21-50% | 🟡 | filling up | Zone picker |
| 1-20% | 🔴 | almost full! | Auto-show full seat map |
| 0% | 🚨 | SOLD OUT | Block, suggest alternatives |

Always show raw numbers: `🟢 94% available (141/150 seats)`

**≤20% available rule:** skip zone picker, render full seat map. If Express provided a zone arg, override it — tell Nathan why: "Only N seats left — showing the full map."

## Scripts

| Script | Purpose | Interface |
|--------|---------|-----------|
| `scripts/pick-seats.py` | Auto-select best adjacent seats in a zone | `--seatmap-file FILE --zone ZONE --count N` → prints seat codes |
| `scripts/fill-ticket.py` | Fill ticket email template | `--movie-title --session-datetime --screen --seats --tickets-file FILE --booking-fee CENTS --total CENTS --poster-url URL` → prints HTML path |

## Safety Invariants

- **NEVER click CHECKOUT** on the Classic Cinemas site (triggers real payment — G7/G10)
- Always confirm before sending email (AskUserQuestion)
- Never hard-code the Gmail account — read from `.productivity.yml` (fall back to `~/code/my-second-brain/.productivity.yml`)
- Validate seats against regex `^[A-Z]\d{1,2}(, [A-Z]\d{1,2})*$` before template fill

## References

| File | Content |
|------|---------|
| [booking-flow.md](references/booking-flow.md) | Full choreography for both modes, API details, error table |
| [arg-parsing.md](references/arg-parsing.md) | Argument parsing spec (right-to-left, examples) |
| [template-fill.md](references/template-fill.md) | 13 template placeholders, HTML escape rules, ticket/invoice line format |
| [email-send.md](references/email-send.md) | `gog gmail send` invocation, temp file handling |
| [booking-log.md](references/booking-log.md) | JSONL schema at `~/.local/state/classic-cinema/bookings.jsonl` |
| [assets/ticket-template.html](references/assets/ticket-template.html) | HTML email template (frozen, never modify) |
