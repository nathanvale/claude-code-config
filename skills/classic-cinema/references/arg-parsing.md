# Argument Parsing — Express Mode

## Format

`/classic-cinema [movie] [time] [tickets] [zone]`

All arguments are optional. Missing arguments become interactive questions.

## Parse Order: Right-to-Left

Parse tokens from the end of the string to handle multi-word movie titles unambiguously.

| Step | Token | Pattern | Examples |
|------|-------|---------|----------|
| 1 | zone | `front\|middle\|back\|surprise` (exact match, case-insensitive) | `middle`, `Back` |
| 2 | tickets | `\d+\+\d+` or bare `\d+` | `1+1`, `2`, `2+1` |
| 3 | time | `\d{1,2}(:\d{2})?\s*(am\|pm)` (case-insensitive) | `10am`, `7:30pm`, `6PM` |
| 4 | movie | Everything remaining | `faraway tree`, `hail mary`, `mario` |

## Ticket Shorthand

| Input | Meaning |
|-------|---------|
| `N+M` | N adults + M children |
| `N` (bare number) | N adults, 0 children |

The `N+M` form is optimised for Nathan + Levi (1 adult + 1 child = `1+1`).

## Worked Examples

| Input | movie | time | tickets | zone |
|-------|-------|------|---------|------|
| `faraway tree 10am 1+1 back` | faraway tree | 10am | 1+1 | back |
| `hail mary 7pm 2` | hail mary | 7pm | 2 | — |
| `mario` | mario | — | — | — |
| `7pm` | — | 7pm | — | — |
| `the drama 9:10pm 1+1 middle` | the drama | 9:10pm | 1+1 | middle |
| `goat 12:20pm 3 front` | goat | 12:20pm | 3 | front |
| _(empty)_ | — | — | — | — |

## Movie Matching

After extracting the movie tokens, fuzzy-match against today's movie list:

1. **Case-insensitive substring match** — check if the query is a substring of any movie title
2. **Single match** → auto-select
3. **Multiple matches** → show disambiguation list, ask Nathan
4. **Zero matches** → "No movies matching '{query}' today. Here's what's on:" → fall back to Browse mode

## What Happens With Missing Args

| Missing | Action |
|---------|--------|
| movie | Show today's full listing, ask which movie |
| time | Show matched movie's sessions with availability emoji, ask which |
| tickets | Ask "How many? (e.g. 1+1 for 1 adult + 1 child)" — default 1 adult |
| zone | Show zone picker (or full seat map if ≤20% available) |

## Edge Cases

- **Time-only arg** (e.g. `/classic-cinema 7pm`): show all movies with a session near 7pm
- **Number ambiguity**: bare `2` is always tickets (2 adults), never a time. Times require `am`/`pm` suffix
- **Zone as movie name**: if a movie were literally called "Back", the parser would incorrectly consume it as zone. This is unlikely given Classic Cinemas' programming. If it happens, Nathan can use Browse mode
