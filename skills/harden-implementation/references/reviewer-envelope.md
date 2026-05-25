# Reviewer envelope

The structured return shape every hardening-loop reviewer must emit. It is the
analogue of the issue-to-pr `validator-envelope.md`: a fixed envelope so the
orchestrating loop can **merge, dedup, triage, and score** findings
deterministically instead of re-parsing a different prose format from each
angle.

Without a fixed shape, reviewers return findings as JSON, as prose, as verdict
tables, or as a mix — and the merge/triage step and the scoring agent must
normalize by hand, which is lossy and inconsistent. This envelope removes that
guesswork.

## Reviewer is find-and-report only

A dispatched reviewer:

- **does not** fix code or write commits (the orchestrating loop applies fixes);
- **does not** decide a finding's final triage class (it proposes `severity`;
  the loop classifies `blocking` / `should-fix` / `note-only` / `out-of-scope`
  during merge);
- **returns** the envelope below as its final message; the loop merges, dedups
  by `signature`, and records the round in the findings ledger.

## Envelope shape (reviewer → orchestrating loop)

Return exactly this shape as the final message. JSON or YAML; JSON preferred for
parse stability.

```yaml
reviewer: <angle name, e.g. adversarial | correctness | testing | maintainability | acceptance-criteria | scope-guard | security | ...>
findings: []          # finding rows; [] means "this angle found nothing actionable"
residual_risks: []    # things checked that did NOT become findings, but a future owner should know
testing_gaps: []      # missing/weak test coverage worth recording (strings)
```

`findings: []`, `{"findings":[]}`, and the full envelope with an empty
`findings` array all mean "no actionable findings from this angle." Stating it
explicitly (rather than returning prose) is what lets the loop count a clean
angle toward convergence honestly.

### Finding row schema

```yaml
problem: "<one-line description of what breaks>"
severity: <blocking | should-fix | note-only | out-of-scope>   # the reviewer's proposed class; the loop makes the final call at triage
location: "<file:symbol | file:section>"   # NEVER a bare line number — line numbers drift
failure_scenario: "<a concrete way it breaks, OR the acceptance criterion it violates>"
signature: <stable kebab-case slug; the SAME root issue raised by two angles MUST share a signature so the loop dedups instead of double-counting>
acceptance_criterion: <the AC id this violates, e.g. R5 | null>   # null when it is not an AC violation
regression: <true | false>   # true only when this was introduced by a hardening fix in a prior round (high signal)
```

Severity meanings (the reviewer proposes; the loop confirms at triage):

- `blocking` — violates an acceptance criterion, or breaks correctness/safety of
  the slice under review.
- `should-fix` — a real weakness with no acceptance-criterion violation.
- `note-only` — worth recording, not worth fixing now.
- `out-of-scope` — a real finding whose fix lives outside this slice (a
  sibling/later slice, a different repo, or deliberately deferred work). Name
  where it belongs in `failure_scenario`.

No praise. No summary of what the code does well. Return only actionable
findings plus the residual-risk and testing-gap context.

## Why `signature` matters

The loop dedups findings across angles by `signature` during merge: two
reviewers flagging the same root issue is **one** finding recorded once, and the
scoring agent credits `new_breaks` to the first/independent raiser and
`merged_into` to the duplicator. A missing or inconsistent signature makes the
same break look like two findings and corrupts the scorecard. Pick a slug that
names the root cause (e.g. `inline-notes-leak`, `nullable-scalar-coercion`), not
the symptom location.

## Malformed output

A return that omits `findings`, makes `findings` a non-array, mixes prose into
the envelope, or emits a partial finding row is malformed. The loop should
re-read the reviewer's message once for a recoverable shape; if it is still
unusable, treat that angle as having returned no parseable findings for the
round and note the malformed shape in the findings ledger (so a flaky reviewer
is visible, not silently counted as clean).

## See also

- [review-angles.md](review-angles.md) — the angle catalog and the per-reviewer
  charter that carries this envelope as its output contract.
- [ledgers.md](ledgers.md) — how merged findings are recorded per round and how
  `signature` / `new_breaks` / `merged_into` feed the scorecard.
