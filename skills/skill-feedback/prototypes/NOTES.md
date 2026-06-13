# PROTOTYPE - ReviewResultData v2 contract contenders

Question:

- Which proposed v2 `ReviewResultData` contract shape earns the Interface at the reducer Seam?
- Judge against false merge, false corroboration, weak-anchor merge, and false readiness.

Run:

- `cd skills/skill-feedback`
- `bun run prototype:review-result-contract`

Contenders:

- Minimal two-key reducer.
- Reducer plus anchor Adapter.
- Full claim-safe `ReviewResultData`.

Verdict:

- Full claim-safe `ReviewResultData` earns the Interface at the reducer Seam.
- Keep the anchor Adapter as an internal Adapter behind that Interface.
- Do not ship the minimal two-key reducer.
- Do not stop at reducer plus anchor Adapter.

Judge board:

- Minimal two-key reducer: 19 aggregate.
- Reducer plus anchor Adapter: 49 aggregate.
- Full claim-safe `ReviewResultData`: 52 aggregate.

Findings:

- Minimal two-key reducer leaks false corroboration when same-anchor reports lack a trusted shared `skill_run_id`.
- Minimal two-key reducer merges repeated weak label-only anchors.
- Minimal two-key reducer collapses Codex Stop runtime evidence into Trusted skill identity readiness.
- Reducer plus anchor Adapter prevents false merge, weak-anchor merge, false corroboration, and false readiness.
- Reducer plus anchor Adapter still lacks enough Interface surface to prevent Claude Stop evidence from implying Codex identity safety.
- Full claim-safe `ReviewResultData` keeps runtime capture, Trusted skill identity, Daily pilot readiness, evidence tiers, and allowed claims in one contract-owned result.

Contract implication:

- Expose `review_unit_key`, `ledger_anchor_key`, `anchor_strength`, `weak_anchor_reason`, evidence tier, allowed claims, and split readiness from the reducer result.
- Derive `review_unit_key` from trusted `skill_run_id`; otherwise use report id.
- Derive `ledger_anchor_key` from canonical repo-contained path sets only.
- Keep weak anchors standalone and emit anchor-miss telemetry.
- Allow mixed source evidence on the same ledger anchor without claiming `corroborated`.
- Claim `corroborated` only with a shared trusted `skill_run_id`.
- Reserve `trusted_engine_identity` for engine-owned identity evidence.

Next:

- Absorb the winning contract shape into the real v2 plan/code.
- Delete this prototype after absorption.
