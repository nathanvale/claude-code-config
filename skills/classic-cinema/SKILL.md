---
name: classic-cinema
description: "Browse movies and generate ticket-style confirmation emails for Classic Cinemas Elsternwick. Use when Nathan asks what's on at the cinema, wants movie details, or wants to 'book tickets'. Generates a personal reminder email — does NOT purchase tickets."
role: tool-workflow
argument-hint: "[movie] [time] [tickets] [zone]"
allowed-tools: Bash, Read, AskUserQuestion, Write
---

# Classic Cinema

Personal reminder-email generator for Classic Cinemas Elsternwick. Walks a conversational booking flow, generates a ticket-style HTML email, and sends it via `gog`. Does NOT purchase tickets or reserve seats — Nathan buys at the box office.

## Owner

- Script interfaces, flags, stdout/stderr behavior, temp files, and parse rules: `skills/classic-cinema/scripts/*.py`.
- Booking choreography and API details: `skills/classic-cinema/references/booking-flow.md`.
- Argument parsing: `skills/classic-cinema/references/arg-parsing.md`.
- Email template fill: `skills/classic-cinema/references/template-fill.md`.
- Email sending: `skills/classic-cinema/references/email-send.md`.
- Booking log shape: `skills/classic-cinema/references/booking-log.md`.
- Legacy plugin retirement criteria: `skills/classic-cinema/references/retirement-criteria.md`.

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
2. **Tickets** — "1+1" = 1 adult + 1 child. Default: 1 adult. ⚠️ Some sessions (arthouse, festival, late-evening) have **no Child tier** — fallback to "2 adults" with Nathan's confirmation, never silently. See [booking-flow.md](references/booking-flow.md#q2--tickets).
3. **Seats** — zone picker or full map (see Availability UX below)

Best case: `/classic-cinema faraway 10am 1+1 middle` → zero questions → confirm → send.

Full choreography in [booking-flow.md](references/booking-flow.md).

## Browse Mode

1. Fetch movie listing via API (instant)
2. After showing the listing, prompt: "Anything catch your eye? Pick a movie to see sessions, or I can pull up a YouTube trailer or synopsis first."
3. **Movie details** — when Nathan asks about a movie, use the API data first (`summary`, `trailer` URL). Supplement with WebSearch only if Nathan wants more (reviews, cast, etc).
4. Nathan picks a movie → show sessions with availability emoji
5. Nathan picks a session → converge with Express at Q2 (Tickets)

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

- Scripts in `scripts/` handle listing, availability, ticket parsing, seat selection, and email-template fill. Inspect each script's `--help` and test contract for exact flags and behavior — the script interfaces are the source of truth, not this file.
- Pass the API `headerImage` value to `scripts/fill-ticket.py`; do not guess a Classic Cinemas URL or use `posterImage`.
- Do not copy script flags, temp-file names, JSON shapes, or stdout/stderr contracts into this file.

## Verification

- Run `python3 skills/classic-cinema/scripts/test_fill_ticket.py` after email-template or ticket-fill changes.
- Run `python3 skills/classic-cinema/scripts/<script>.py --help` after script interface edits.
- Use live API checks only when listing, availability, or booking choreography changed.

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
| [retirement-criteria.md](references/retirement-criteria.md) | Legacy plugin retirement checklist |
| [assets/ticket-template.html](references/assets/ticket-template.html) | HTML email template (frozen, never modify) |
