# Booking Log

## Location

```
~/.local/state/classic-cinema/bookings.jsonl
```

XDG-compliant state path. Append-only. One JSON object per line. Created on first use.

## Schema

Each line is a JSON object with these fields:

```json
{
  "timestamp": "2026-04-08T18:15:23+10:00",
  "movie_title": "Project Hail Mary",
  "session_datetime": "Wed 8 Apr, 06:30PM",
  "screen": "Screen 1",
  "seats": "E8, E9",
  "tickets": [
    {"type": "ADULT", "quantity": 1, "price": "$27.00"},
    {"type": "CHILD", "quantity": 1, "price": "$17.00"}
  ],
  "booking_fee": "$3.90",
  "total": "$47.90",
  "gmail_message_id": "19d6c19e4074f7b8",
  "notes": ""
}
```

**Required fields:** `timestamp`, `movie_title`, `session_datetime`, `screen`, `seats`, `tickets`, `total`, `gmail_message_id`.

**Optional fields:** `booking_fee`, `notes`.

## Append pattern

```bash
LOG_DIR="$HOME/.local/state/classic-cinema"
LOG_FILE="$LOG_DIR/bookings.jsonl"
mkdir -p "$LOG_DIR"

# Build the JSON object — jq -cn (compact) is mandatory; bare jq -n pretty-prints
# multi-line and corrupts the one-line-per-entry JSONL.
ENTRY=$(jq -cn \
  --arg ts "$(date -Iseconds)" \
  --arg movie "$MOVIE_TITLE" \
  --arg dt "$SESSION_DATE_TIME" \
  --arg screen "$SCREEN_NUMBER" \
  --arg seats "$SEATS" \
  --argjson tickets "$TICKETS_JSON" \
  --arg fee "$BOOKING_FEE" \
  --arg total "$TOTAL_AMOUNT" \
  --arg msgid "$GMAIL_MSG_ID" \
  '{timestamp: $ts, movie_title: $movie, session_datetime: $dt, screen: $screen, seats: $seats, tickets: $tickets, booking_fee: $fee, total: $total, gmail_message_id: $msgid, notes: ""}')

echo "$ENTRY" >> "$LOG_FILE"
```

**Rules:**
- Use `jq -cn` to emit compact JSON (one line per entry) — the `-c` is mandatory; bare `jq -n` pretty-prints multi-line and corrupts the JSONL
- ALWAYS append (`>>`), never overwrite (`>`)
- Append AFTER a successful email send (not before, not on failure)
- Don't rewrite or truncate the log — it's append-only

## Read pattern (for future "what did I see last month")

```bash
# Last 10 entries
tail -n 10 ~/.local/state/classic-cinema/bookings.jsonl | jq .

# Filter by movie
jq 'select(.movie_title | contains("Hail Mary"))' ~/.local/state/classic-cinema/bookings.jsonl

# Filter by date range
jq 'select(.timestamp >= "2026-03-01" and .timestamp < "2026-04-01")' ~/.local/state/classic-cinema/bookings.jsonl
```

The skill does NOT need to implement these queries in v1 — they're here as examples so Nathan (or a future skill) can use the log.

## Invariants

- Append-only. Never rewrite.
- One JSON object per line.
- UTF-8.
- Compact (no pretty-printing).
- No PII beyond movie + seats + timestamp (intentionally no customer name in the log — it's implicit).
- No payment data (we don't have any).
- File is user-only readable (mode 0600 set by umask; do not explicitly chmod).
