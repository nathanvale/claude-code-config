# U2 review - Quarantine redacted and unverifiable anchors

- Run: `20260613-982f71e0` · base `38ab9f7` · verdict **clean**
- Owner files: redaction.ts, ledger-anchor-adapter.ts(+test), review-ledger-reducer.test.ts, skill-feedback.test.ts, references/redaction.md, references/report-shape.md
- Requirements: R5, R14

## Verdict: met

- Redacted path targets become weak `unverifiable` anchors via `containsRedactionMarker` (ledger-anchor-adapter.ts:782-814); two distinct redacted paths do **not** merge into one repeated-anchor entry.
- Redaction ownership stayed in `redaction.ts`; anchor safety stayed in `ledger-anchor-adapter.ts` - no hidden merge key for redacted paths (no secret-bearing state reintroduced).
- Control-character / fake-heading fixtures: JSON path safe via `JSON.stringify`; plain path safe via `plainSafe`.

## Findings touching U2 owners

None blocking.

- **#4-adjacent (plain-lane delimiter, P3, confidence 50)** - adversarial noted `plainSafe` strips control chars/newlines but not commas/`=`; a directly-placed report with `touched_surfaces: "a, fakeclaim=corroborated"` could spoof ledger-line `targets=`/`sources=` columns in the **human-only plain lane** (JSON lane safe). Low confidence, human-only surface. Escape field-internal delimiters or treat plain output as advisory. Routed here because it touches the redaction/plain-render boundary.

## What's proven

Redaction cannot collapse unrelated paths into one strong anchor. The one open edge is plain-lane field-delimiter spoofing, which is cosmetic (human display only) and low-confidence.
