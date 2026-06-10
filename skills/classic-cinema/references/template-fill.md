# Template Fill — Classic Cinema Ticket

The template at `references/assets/ticket-template.html` is a byte-identical copy of `the-cinema-bandit/classic-cinemas-email-template.html` (MD5: `63b58d49afbc14aba9809d10c33ec066`). **NEVER modify this template.** All substitution rules below are copied from the old plugin's `src/template.ts` (commit behavior as of 2026-04-08).

## Template Placeholders

The template contains exactly these 13 `{{PLACEHOLDER}}` strings:

| Placeholder | Source | Escape? | Default if missing |
|---|---|---|---|
| `{{CUSTOMER_NAME}}` | Nathan's first name | HTML-escape | `"Nathan"` |
| `{{MOVIE_TITLE}}` | from browse stage | HTML-escape | — (required) |
| `{{MOVIE_IMAGE_URL}}` | **REQUIRED** — pass the API's `headerImage` field verbatim (e.g. `"movies/headers/the-super-mario-galaxy-movie.jpg"`) to `--poster-url`. The fill-ticket script's `resolve_poster_url()` prepends the CDN base `https://movingstory-prod.imgix.net/` automatically. **DO NOT** construct the URL by guessing `https://www.classiccinemas.com.au/...` — that domain 404s for poster paths. **DO NOT** use `posterImage` (portrait, breaks the email layout) — always use `headerImage` (landscape banner). | URL — do NOT escape | **NO DEFAULT** — if missing, STOP and fetch it |
| `{{SESSION_DATE_TIME}}` | from pricing stage | HTML-escape | — (required) |
| `{{SCREEN_NUMBER}}` | from pricing stage | HTML-escape | — (required) |
| `{{SEATS}}` | from seat selection — see **Seats Format Contract** below | HTML-escape | — (required) |
| `{{BARCODE_URL}}` | see Default Barcode below | URL — do NOT escape | DEFAULT_BARCODE |
| `{{WEB_VIEW_URL}}` | `"#"` (no web view available) | URL — do NOT escape | `"#"` |
| `{{BOOKING_NUMBER}}` | `"N/A"` — skill does not create real bookings | HTML-escape | `"N/A"` |
| `{{BOOKING_FEE}}` | from pricing stage, format as `"$X.XX"` | HTML-escape | `"$0.00"` |
| `{{TOTAL_AMOUNT}}` | calculated locally: `Σ(qty × price) + fees`, format as `"$X.XX"` | HTML-escape | `"$0.00"` |
| `{{TICKET_LINES}}` | generated HTML block, see Ticket Lines below | special | `""` |
| `{{INVOICE_LINES}}` | generated HTML block, see Invoice Lines below | special | `""` |

## Seats Format Contract

**The `{{SEATS}}` value MUST follow this exact format:** `{LETTER}{NUMBER}[, {LETTER}{NUMBER}]...`

- Row letter: single uppercase A-Z (matches Classic Cinemas' `.seating-map__letter` element text)
- Seat number: 1 or 2 digits, NO zero padding (matches what's displayed on the seat button)
- Separator: comma + single space (`, `)
- NO row words ("row", "Row 0", "back", "front")
- NO parenthetical annotations ("(back)", "(premium)")
- NO ampersands or words between seats ("seats 6 & 7" is WRONG)
- NO screen numbers embedded in the string

**Correct examples:**
- `E7, E8`
- `B1, B2, B3`
- `G10, G11`
- `A4`

**WRONG examples (must be rejected by the skill before template fill):**
- ❌ `Row 0 (back), seats 6 & 7`
- ❌ `Row E seats 7 and 8`
- ❌ `E7 and E8`
- ❌ `back row, 6, 7`
- ❌ `6, 7` (missing row letter)
- ❌ `E 7, E 8` (space between letter and number)

**Extraction rules** — how the skill derives this from what ba-browse returns:

1. For each selected seat DOM element, read:
   - The row letter from the closest `.seating-map__row`'s `.seating-map__letter` element text (uppercase A-Z)
   - The seat number from the button's text content or `aria-label` (digits only)
2. Concatenate as `{LETTER}{NUMBER}` (no space)
3. Join with `, ` (comma + single space)
4. If ANY seat is missing a row letter → STOP, do NOT guess, do NOT invent "Row 0" or "(back)". Re-dispatch ba-browse with an action prompt that explicitly demands the row letter be extracted from `.seating-map__letter`, or surface the issue to Nathan and ask directly which row.

**Validation before template fill:** Run the final `{{SEATS}}` string through this regex: `^[A-Z]\d{1,2}(, [A-Z]\d{1,2})*$`. If it doesn't match, STOP and fix the upstream data — DO NOT fill the template with malformed seat data.

## HTML Escape Function

Apply this to every field marked "HTML-escape":

```
& → &amp;
< → &lt;
> → &gt;
" → &quot;
' → &#39;
```

Done in that order. URLs and the special `{{TICKET_LINES}}` / `{{INVOICE_LINES}}` blocks are NOT escaped through this function (they contain intentional HTML or are URLs).

## Default Barcode URL

The old plugin hard-codes this barcode URL as a Google images proxy link:

```
https://ci3.googleusercontent.com/meips/ADKq_NaPR1UO0ABCDdjEmZOs7NnkHZe3ZB9YpKHGLyNCZXD0FH7h5UZJtQMgCD1Mn6jiareUCWODOHBZEfc1cWLPEXoxFYlSTfxxbYlc9PY9F8A=s0-d-e1-ft#https://www.classiccinemas.com.au/api/barcode/WHRT69C.jpg
```

**Use this verbatim every time.** It's a placeholder barcode (`WHRT69C.jpg`) — not a real ticket barcode. Matches old plugin behavior.

## Ticket Lines (TICKET_LINES)

For each ticket-type selection (e.g. `Adult x 2`, `Child x 1`), generate one table row:

```html
                                                                <tr>
                                                                    <td
                                                                            style="font-family: antwerp, sans-serif; font-size: 16px; line-height: 24px; color: #000000;">
                                                                    <span class="outlook-body-font">{TICKET_TYPE_NAME} x {QUANTITY}</span>
                                                                    </td>
                                                                </tr>
```

Where `{TICKET_TYPE_NAME}` is the ticket type formatted as `"Adult Ticket"`, `"Child Ticket"`, `"Concession Ticket"`, etc. — **always suffixed with `" Ticket"`**. The formatter (from old plugin's `formatTicketTypeName`):

- Input: `"ADULT"` → Output: `"Adult Ticket"`
- Input: `"CHILD"` → Output: `"Child Ticket"`
- Input: `"CONCESSION"` → Output: `"Concession Ticket"`
- Input: `"SENIOR"` → Output: `"Senior Ticket"`
- Input: `"STUDENT"` → Output: `"Student Ticket"`
- Input: `"PENSION"` → Output: `"Pension Ticket"`

Logic: lowercase everything, uppercase the first letter, append `" Ticket"`.

Escape the type name and quantity through the HTML-escape function. Join all rows with `\n`.

## Invoice Lines (INVOICE_LINES)

For each invoice line (description + price), generate this block:

```html
                            <tr>
                                <td
                                        style="font-family: antwerp, sans-serif; font-size: 14px; line-height: 14px; color: #414141;">
                                    <span class="outlook-body-font">{DESCRIPTION}</span>
                                </td>
                                <td style="font-family: antwerp, sans-serif; font-size: 14px; line-height: 14px; color: #414141; text-align: right;">
                                    <span class="outlook-body-font">{PRICE}</span>
                                </td>
                            </tr>
                            <tr class="no-print">
                                <td colspan="2" style="font-size: 0; padding-top: 2px; padding-bottom: 2px;">
                                    <p style="width: 100%; border-top: dashed 1px #000000; font-size: 1;">
                                        &nbsp;</p>
                                </td>
                            </tr>
```

Where `{DESCRIPTION}` is like `"Adult Ticket x 2"` (same formatter as ticket lines) and `{PRICE}` is the line subtotal formatted as `"$40.00"`.

Escape both fields through the HTML-escape function. Join all blocks with `\n`.

## Substitution Order

1. Start with the raw template string
2. `replaceAll` each of the 13 placeholders in order (order doesn't matter since placeholder names don't collide)
3. Return the resulting HTML string

## Example Fill (Worked)

Given:

```
customerName: "Nathan"
movieTitle: "Project Hail Mary"
sessionDateTime: "Wed 8 Apr, 06:30PM"
screenNumber: "Screen 1"
seats: "E8, E9"
tickets: [{type: "ADULT", quantity: 1}, {type: "CHILD", quantity: 1}]
invoiceLines: [
  {description: "Adult Ticket x 1", price: "$27.00"},
  {description: "Child Ticket x 1", price: "$17.00"}
]
bookingFee: "$3.90"
totalAmount: "$47.90"
moviePoster: (empty, unknown)
```

Then:
- `{{CUSTOMER_NAME}}` → `Nathan`
- `{{MOVIE_TITLE}}` → `Project Hail Mary`
- `{{MOVIE_IMAGE_URL}}` → `` (empty)
- `{{SESSION_DATE_TIME}}` → `Wed 8 Apr, 06:30PM`
- `{{SCREEN_NUMBER}}` → `Screen 1`
- `{{SEATS}}` → `E8, E9`
- `{{BARCODE_URL}}` → the DEFAULT_BARCODE URL above
- `{{WEB_VIEW_URL}}` → `#`
- `{{BOOKING_NUMBER}}` → `N/A`
- `{{BOOKING_FEE}}` → `$3.90`
- `{{TOTAL_AMOUNT}}` → `$47.90`
- `{{TICKET_LINES}}` → two `<tr>` blocks: `Adult Ticket x 1` and `Child Ticket x 1`
- `{{INVOICE_LINES}}` → two `<tr>` blocks with the invoiceLines data

## Implementation Note

The skill does template fill via the committed `src/fill-ticket.ts` command. **Do NOT use heredoc/here-string input** (`bun -e`, `python3 -c`, `node -e`, `<< 'EOF'`, etc.) — Nathan's `PreToolUse:Bash` git-safety hook blocks interpreter commands receiving stdin/heredoc with the error: *"Interpreter commands receiving heredoc/here-string input cannot be safety-analyzed reliably."*

Required pattern:

1. Run `bun run src/parse-tickets.ts --session-id $SID --spec "1+1"` to build `/tmp/cc-tickets-selected.json`
2. Run `bun run src/fill-ticket.ts --tickets-file /tmp/cc-tickets-selected.json ...` — the script prints the output HTML path
3. The output file is `/tmp/classic-cinema-ticket-<ts>.html`
4. After the email sends successfully, clean up temp files

**NEVER use an inline interpreter** (`bun -e`, `python3 -c`, heredocs, etc.) — the git-safety hook blocks it. All logic lives in the committed `src/*.ts` commands.
