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

- Runtime: **Bun**. Commands live at `skills/classic-cinema/src/*.ts`; run with `bun run skills/classic-cinema/src/<command>.ts`. Each command's `--help` is the source of truth for flags, stdout/stderr, temp files, and exit codes — do not copy them here.
- Shared API client + types (base URL, fetch+cache, AEST time, seatmap shapes): `skills/classic-cinema/src/cinema-api.ts`.
- Booking-log model + validation: `skills/classic-cinema/src/booking-log.ts`.
- Booking choreography and API details: `skills/classic-cinema/references/booking-flow.md`.
- Argument parsing: `skills/classic-cinema/references/arg-parsing.md`.
- Email template fill: `skills/classic-cinema/references/template-fill.md`.
- Email sending: `skills/classic-cinema/references/email-send.md`.
- Booking log shape: `skills/classic-cinema/references/booking-log.md`.
- Skill health doctor: `skills/classic-cinema/src/heal-skill.ts` (run `heal-skill check` when a booking fails or output looks wrong).
- Legacy Python scripts under `scripts/*.py` are superseded by `src/*.ts`; retirement criteria: `skills/classic-cinema/references/retirement-criteria.md`.

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

## Commands

Run from the repo root. Each `--help` owns its flags; inspect it rather than guessing.

| Step | Command |
|------|---------|
| Listing / details | `bun run skills/classic-cinema/src/list-movies.ts [--movie QUERY]` |
| Availability | `bun run skills/classic-cinema/src/check-availability.ts --session-ids ID[,ID]` |
| Tickets + pricing | `bun run skills/classic-cinema/src/parse-tickets.ts --session-id ID --spec "1+1"` |
| Seat pick | `bun run skills/classic-cinema/src/pick-seats.ts --seatmap-file PATH --zone ZONE --count N` |
| Fill email | `bun run skills/classic-cinema/src/fill-ticket.ts …` (then send via `gog`, see [email-send.md](references/email-send.md)) |
| Health doctor | `bun run skills/classic-cinema/src/heal-skill.ts check` |

- Pass the API `headerImage` value to `fill-ticket.ts`; do not guess a Classic Cinemas URL or use `posterImage`.
- Do not copy command flags, temp-file names, JSON shapes, or stdout/stderr contracts into this file.

## Gotchas

- **Always emit booking-log entries with `jq -cn` (compact), never bare `jq -n`.** `jq -n` pretty-prints multi-line by default, so one entry becomes many lines and corrupts the one-line-per-entry JSONL. (Verified 2026-06-11: the cause is the `-n`-pretty default, not a git-safety hook — that hook is retired.) `parse-tickets.ts` and the send flow write through `Bun.write`; if you hand-append, build with `jq -cn` and `>>` it. Recover with `heal-skill repair --only booking-log-valid --execute`.
- **`fill-ticket.ts` uses `replaceAll`, not `replace`.** `{{MOVIE_TITLE}}` appears 3× and `{{WEB_VIEW_URL}}` 2× in the frozen template; a single-occurrence replace would ship literal `{{…}}` tokens in the email.

## Verification

- After any `src/` change: `skills/test-runner/src/test-runner.sh run --cwd skills/classic-cinema -- src/cinema-api.test.ts src/pick-seats.test.ts src/fill-ticket.test.ts src/booking-log.test.ts` and `cd skills/classic-cinema && bunx tsc --noEmit -p tsconfig.json`.
- After any change: `bunx biome check --diagnostic-level=error skills/classic-cinema/src/`.
- Whole-skill health (scripts, frozen template, booking log, owner paths): `bun run skills/classic-cinema/src/heal-skill.ts check`.
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
