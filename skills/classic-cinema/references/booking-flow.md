# Booking Flow — Conversational Choreography

All data comes from public Classic Cinemas APIs via `curl`. No browser dispatch needed — all 4 APIs are cookie-free (see domain gotcha G18).

## APIs

| Endpoint | Returns |
|----------|---------|
| `GET /api/movies` | Full movie catalog (join key: `vistaId`) |
| `GET /api/sessions/0000000002` | All upcoming sessions (filter by today's date) |
| `GET /api/sessions/0000000002/{sessionId}/tickets` | Ticket types + prices |
| `GET /api/sessions/0000000002/{sessionId}/seating-map` | Seat grid with availability |

**Cinema ID** is always `0000000002` (Elsternwick).

**Image CDN:** prefix `movie.thumbnailImage` with `https://movingstory-prod.imgix.net/` and append `?w=450&h=193&auto=compress,format&fit=crop`.

**Movie object fields:** `name` (title string), `vistaId` (join key), `rating` (object — use `rating.id` for classification string e.g. "PG", "M", "MA15+"), `summary`, `runtime`, `duration`, `thumbnailImage`, `posterImage`, `headerImage`, `trailer`, `cast`, `genres`, `slug`, `link`.

**Session object fields:** `id` (session ID), `movieId` (join key → `movie.vistaId`), `date` (ISO datetime), `screenName`, `screenNumber`, `typeName`, `attributes`, `allocatedSeating`, `link`.

---

## Stage 0 — Data Fetch (both modes)

```bash
# Browse mode — full listing:
python3 scripts/list-movies.py

# Express mode — fuzzy match a movie:
python3 scripts/list-movies.py --movie "faraway"
```

The script fetches both APIs, filters to today (AEST), joins on `session.movieId === movie.vistaId`, and prints one JSON object per line. It also writes `/tmp/cc-sessions.json` and `/tmp/cc-movies.json` for downstream scripts.

**Output format (one JSON object per line):**
```json
{"index": 1, "name": "...", "vistaId": "...", "rating": "PG", "runtime": "...", "sessions": [{"id": "...", "time": "10:00am", "screen": "Screen 3", "screenNumber": 3, "date": "..."}]}
```

**IMPORTANT:** Always run this script via `python3 scripts/list-movies.py` — never use inline Python or curl+inline-processing. The git-safety hook blocks inline interpreter execution.

Then classify intent per SKILL.md and route to Express or Browse.

---

## Express Mode

### Q1 — Movie + Session

If movie was parsed from args, fuzzy-match (case-insensitive substring) against today's movie list.

For the matched movie, calculate availability using the dedicated script (it auto-fetches seatmaps from the API if not already cached):
```bash
python3 scripts/check-availability.py --session-ids 122897,122870,122871
```

**IMPORTANT:** Always use `check-availability.py` — never use inline Python or shell processing. The git-safety hook blocks inline interpreter execution. No separate `curl` step is needed — the script fetches missing seatmaps automatically.

Output is one JSON line per session: `{"sid": 122897, "screen": "Screen 3", "available": 141, "total": 150, "pct": 94}`

Present to Nathan:
```
The Magic Faraway Tree (G)
  1. 10:00 AM Screen 3  🟢 94% available (141/150)
  2. 12:30 PM Screen 5  🟡 48% available (58/120)
  3.  3:00 PM Screen 3  🔴 only 15 seats left! (15/150)
  4.  5:30 PM Screen 8  🚨 SOLD OUT
```

If time was in args, auto-select the nearest non-SOLD-OUT session. Otherwise ask.

**Full-args fast path:** when all args are resolved (movie + time + tickets + zone), skip the multi-session availability display entirely — fetch only the selected session's seat map and pricing, then go straight to seat selection and confirm.

### Q2 — Tickets

Use the `parse-tickets.py` script to fetch ticket types, parse the spec, and build the selection file in one step:
```bash
python3 scripts/parse-tickets.py --session-id $SESSION_ID --spec "1+1"
```

The script auto-fetches `/tmp/cc-tickets.json` from the API if not already cached, filters to `categoryId == 2` (public ticket types), and outputs a JSON summary:
```json
{"tickets": [...], "bookingFeeCents": 390, "totalCents": 4790, "summary": "1x Adult ($27.00) + 1x Child ($17.00) + fees ($3.90) = $47.90", "selectedFile": "/tmp/cc-tickets-selected.json"}
```

It also writes `/tmp/cc-tickets-selected.json` — the file that `fill-ticket.py --tickets-file` expects.

**IMPORTANT:** Always use `parse-tickets.py` — never use inline Python to parse ticket data. The git-safety hook blocks inline interpreter execution.

**Spec format:** positional slots map to Adult, Child, Concession, Senior, Student, Pension. E.g. `"1+1"` = 1 Adult + 1 Child, `"2"` = 2 Adult.

If tickets were in args, auto-calculate. Otherwise ask: "How many? (e.g. 1+1 for 1 adult + 1 child)"

### Q3 — Seats

**Decision tree based on availability:**

- **>20% available:** show zone picker
- **≤20% available (🔴):** auto-show full ASCII seat map, override any zone arg. Tell Nathan: "Only N seats left — showing the full map so you can see what's available"
- **0% available (🚨):** should have been blocked at Q1. If reached here, stop and suggest alternatives

**Zone picker:**
```
Screen 3 — 🟢 94% available (141/150 seats)

  1. 🎬 Front (rows B-D)
  2. 🪑 Middle (rows E-H) ← recommended
  3. 🍿 Back (rows J-M)
  4. 🎲 Surprise me!
  5. 🗺️  Pick exact seats (show full map)
```

If zone was in args AND availability >20%, auto-select via `pick-seats.py`:
```bash
python3 scripts/pick-seats.py --seatmap-file /tmp/cc-seatmap-$SESSION_ID.json --zone middle --count 2
```

Present result:
```
→ Auto-selected: F7, F8 (center middle)
Happy with these, or pick different? (yes / show map / re-pick)
```

If "pick exact seats" or `pick-seats.py` exits non-zero, render the full ASCII seat map (see Seat Map Rendering below).

### Confirm + Send

Show summary:
```
Confirm your booking:
  Movie:   The Magic Faraway Tree
  Session: Thu 10 Apr, 10:00 AM, Screen 3
  Tickets: 1× Adult ($27.00) + 1× Child ($17.00)
  Seats:   F7, F8
  Total:   $47.90

  This will generate a ticket-style email (reminder only, not an actual cinema booking).
```

AskUserQuestion: **Yes send** / **No cancel**

If yes:
1. Write tickets JSON to `/tmp/cc-tickets-selected.json`
2. Run `fill-ticket.py` (see [template-fill.md](template-fill.md) for substitution spec)
3. Run `gog gmail send` (see [email-send.md](email-send.md) for invocation)
4. On success: append to booking log (see [booking-log.md](booking-log.md)), clean up temp files
5. Confirm: "Sent! Enjoy The Magic Faraway Tree at 10:00 AM. 🍿"

---

## Browse Mode

1. **List** — show numbered movie list from Stage 0 data:
   ```
   🎬 Films showing today at Classic Cinemas Elsternwick:

     1. Project Hail Mary (M) — 11am, 12:15pm, 2:20pm, 3:30pm, 7pm, 8:20pm
     2. The Super Mario Galaxy Movie (PG) — 10am, 11am, 1:20pm, 3:40pm, 6pm
     3. The Drama (MA15+) — 1:20pm, 3:40pm, 6:50pm, 9:10pm
     ...
   ```
   Close with: "Anything catch your eye? If you're not sure about a movie, I can show you a trailer." (The `trailer` field in the movie API contains a YouTube video ID — build the URL as `https://www.youtube.com/watch?v={trailer}`. Only offer trailers for movies where `trailer` is non-empty.)

2. **Pick movie** — Nathan picks a number. Offer "show details" for synopsis/trailer (from `/api/movies` data — local, no fetch needed).

3. **Show sessions with availability** — fetch seating maps for that movie's sessions (parallel curl). Show emoji + seat counts (same format as Express Q1).

4. **Pick session** — Nathan picks a session number.

5. **Converge** — from here, the flow is identical to Express Q2 (Tickets) onward.

---

## Availability Emoji

| % Available | Emoji | Label |
|-------------|-------|-------|
| 51-100% | 🟢 | plenty available |
| 21-50% | 🟡 | filling up |
| 1-20% | 🔴 | almost full! |
| 0% | 🚨 | SOLD OUT |

**Always show raw numbers:** `🟢 94% available (141/150 seats)`

**Calculation** is handled by `check-availability.py` (never inline):
```bash
python3 scripts/check-availability.py --session-ids 122897,122870,122871
```
Logic: `total` = seats where `typeId != "gap"`, `unavail` = seats where `sold == true` OR `unavailable == true`, `available = total - unavail`, `pct = (available / total) * 100`.

---

## Seat Map Rendering

When rendering the full ASCII seat map (for 🔴 sessions or "pick exact seats"):

```
                    ╔═══════════╗
                    ║  SCREEN 3 ║
                    ╚═══════════╝

B   · · · · · · · · · · · ·
C   · · · · · · · · · · · ·
D   · · · · · · · · · · · · · · ·
E   · · · · · · · · · · · · · · ·
F   · · · · · · · · · · · · · · ·
G   · · · · · · X X X X · · · · ·
H   · · · · · · · · · · · · · · ·
J   · · · · · · · · · · · · · · ·
K   · · · ▪ ▪ · · · · · · · · · ·
L     · · X X X · · · · ·
M   ♿♿☐☐  · · · · · · · · · ·

· = available   X = sold   ▪ = blocked   ♿ = wheelchair   ☐ = companion
```

Row letters come from `rows[].name`. Skip gap rows. Use the API data, not hardcoded layouts.

**Seat validation:** before template fill, validate the final seats string against: `^[A-Z]\d{1,2}(, [A-Z]\d{1,2})*$`. If it doesn't match, stop and fix.

---

## Error Recovery

| Error | Recovery |
|-------|----------|
| `curl` non-200 on any API | Retry once. If still failing: "Classic Cinemas API is down — try again later" |
| Sessions API returns no sessions for today | "No sessions showing today at Elsternwick" |
| Seating-map returns empty `rows[]` | Show warning, ask Nathan to type seat codes manually |
| `pick-seats.py` exits non-zero | Render full ASCII map, ask Nathan to pick manually |
| `fill-ticket.py` exits non-zero | Show stderr + temp data paths. Do NOT send email |
| `gog gmail send` non-zero | Keep temp HTML, show error + path, offer retry command |
| Fuzzy match returns 0 movies | "No movies matching '{query}' today. Here's what's on:" → Browse mode |
| Fuzzy match returns 3+ movies | Show disambiguation list, ask Nathan to pick |
| SOLD OUT session selected | Block, suggest alternative sessions for the same movie |

---

## Temp File Cleanup

On successful email send, clean up:
- `/tmp/cc-sessions.json`
- `/tmp/cc-movies.json`
- `/tmp/cc-seatmap-*.json`
- `/tmp/cc-tickets.json`
- `/tmp/cc-tickets-selected.json`
- `/tmp/classic-cinema-ticket-*.html`

On failure, keep all temp files and surface paths for debugging.
