# Consolidated findings report — shape

One report for the whole branch. Verified findings only (post verify pass). Merge cross-unit themes.

```markdown
# <feature> — Consolidated review findings
Branch: <branch> (HEAD <sha>) · Reviewed: <date>
Method: one persona-matched reviewer per unit + cross-seam reviewer + verify pass.

## Verdict roll-up
| Unit | Commit | Persona | Verdict |
(ship | ship-with-nits | fix-before-merge per unit)

## Overall: <verdict> — <n blockers, n major, ...>
One paragraph: what held up, where the gaps cluster.

## BLOCKER (n)
Bn · <unit> · <title> — <file:line> — <what> — <why it blocks> — <fix>

## MAJOR (n)
Mn · <unit> · <title> — <file:line> — <what> — <why> — <fix>

## MINOR / NIT
mn · <unit> · <title> — <file:line> — <fix>

## Confirmed CLEAN
Per unit that passed: one line on what was verified.

## Recommended fix order
Smallest blast radius first (docs → self-contained → cross-cutting clusters).

## Notes
- Read-only; nothing changed. Per-unit lenses at <path>.
- Decisions excluded by design (do-not-flag): <list>.
```

## Rules
- Only findings that survived the verify pass appear. Dropped ones get a one-line "considered, refuted" note at most.
- Merge findings that are the same root cause across units into one themed entry.
- Fix order is by blast radius, not severity — a doc fix before a finance-path cluster, even if both are "major".
