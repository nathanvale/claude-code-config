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
- **does not** decide a finding's final disposition (it proposes a `severity`
  P-level; the loop sets `status` — fixed / deferred-P2 / deferred-P3 /
  out-of-scope / open — during merge and triage);
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
severity: <P0 | P1 | P2 | P3>   # the reviewer's proposed priority; the loop sets status at triage
location: "<file:symbol | file:section>"   # NEVER a bare line number — line numbers drift
failure_scenario: "<a concrete way it breaks, OR the acceptance criterion it violates>"
signature: <stable kebab-case slug; the SAME root issue raised by two angles MUST share a signature so the loop dedups instead of double-counting>
acceptance_criterion: <the AC id this violates, e.g. R5 | null>   # null when it is not an AC violation
regression: <true | false>   # true only when this was introduced by a hardening fix in a prior round (high signal)
```

Severity meanings (the reviewer proposes the P-level; the loop sets the final
`status` at triage). This is the same P0–P3 scale the issue-to-pr Validator
findings use:

- `P0` — violates an acceptance criterion, or breaks correctness/safety of the
  slice under review. The loop fixes it this round.
- `P1` — a serious weakness to fix this slice. The loop fixes it this round.
- `P2` — a real but deferrable weakness. The loop records it to the audit
  backlog (`status: deferred-P2`), does not fix it now.
- `P3` — minor; record and defer (`status: deferred-P3`).

A finding whose fix lives outside this slice (a sibling/later slice, a different
repo, deliberately deferred work) keeps its P-level but the loop sets
`status: out-of-scope` and names where it belongs in `failure_scenario`.

Severity decides **fix-vs-defer**, not when the loop stops. The loop fixes
P0/P1 and defers P2/P3, but it keeps running until a full round surfaces no new
findings of ANY severity — a newly-found P2 still costs another round. So rate
honestly: inflating a P2 to P1 forces a fix the loop would otherwise defer;
sandbagging a real P0 to P2 lets a correctness break ship as backlog; but
either way the finding must be reported, because an unreported P3 is the one
thing that can fake convergence.

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
