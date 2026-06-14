# U7 review — Prove cross-lane behavior and update references

- Run: `20260613-u6u7` (focused increment) · base `38ab9f7` · verdict **clean (P3 only)**
- Owner files: hooks/fixtures/skill-feedback/fallow-close.jsonl, hooks/skill-feedback-hooks.test.ts, skill-feedback.test.ts, review-ledger-reducer.test.ts, references/report-shape.md, references/redaction.md, CONTEXT.md, SKILL.md
- Requirements: R4, R8, R22, R23, R25

## Verdict: met — the smoke-test gap is closed

The cross-lane e2e (skill-feedback.test.ts:1336, "primary hook capture and closeout with one strong anchor show mixed evidence only") runs the **real runner subprocess** and proves the conservative claim boundary (R25/AE10):

- `corroborated` is **absent** from `allowed_claims` (1223), `evidence_tier` (1224), and plain output (1887) across the cross-lane tests.
- The comment at 1834 documents the boundary: mixed evidence is visible, sources allowed, but the renderer cannot show `corroborated` "until a writer-owned correlation source exists."
- The boundary is genuinely unbypassable: verified in the reducer (`promoteEvidenceTier:267`, `sameTrustedRunMixedEvidence:292`) — raw inbox JSON cannot mint the `trusted_run_evidence` that `corroborated` requires.

Unknown-skill Codex Stop + closeout does **not** create a primary ledger entry for the unknown capture; it drives `runtime_capture` to evidence-only and is excluded from ledger/coverage.

References (CONTEXT.md, SKILL.md, report-shape.md, redaction.md) updated to name the low-signal lane, inbox health, purge, and the trusted-run limitation.

## Findings

- **#14 (P3, advisory)** — coverage split: the **real-runner** cross-lane test asserts `corroborated` absent from `allowed_claims` (the renderer-facing gate); `evidence_tier` and plain-output absence are asserted on **stubbed-runtime** tests. The boundary itself is sound and not bypassable — this is a test-organization nit, not a gap. Optional: add `evidence_tier` + plain assertions to the real-runner e2e so all three live on one real-runner path.

## What's proven

U7 closes the exact gap the plan named: the live hook-capture + driver-closeout path cannot overclaim, and `corroborated` stays blocked until a writer-owned correlation source lands. This is the conservative posture the plan committed to.
