# U1 review - Seal public capture telemetry and raw provenance

- Run: `20260613-982f71e0` · base `38ab9f7` · 10 reviewers · verdict **clean**
- Owner files: command-contract.ts(+test), skill-feedback-runner.ts, skill-feedback.test.ts, review-ledger-reducer.ts(+test), hooks/skill-feedback-runtime.ts, hooks/skill-feedback-hooks.test.ts, references/report-shape.md
- Requirements: R1-R4, R16, R24

## Verdict: met - trust boundary sealed

The keystone unit is correct and comprehensively sealed. Security, correctness, and adversarial reviewers each tried to route forged input to a trusted claim; **every refutation held**:

- `normalizeV1Report` (command-contract.ts:1620-1623) validates `skill_run_id_provenance` for shape but **drops it** from the normalized report → `trustedSkillRunId` (reducer:177-188) sees `undefined` → `trusted_run` stays false → no coalescing, no `same_trusted_run`/`corroborated`.
- `hasTrustedEngineIdentity` hardwired `false` (reducer:282-286) → `trusted_engine_identity` unreachable.
- Public stdin `model` now routes through `redactText` (redaction.ts:80-82); `ghp_` token → `[redacted]`. Verified by test.
- Review error envelopes carry the review contract schema version (R16).

## Findings touching U1 owners

None blocking. Two cross-unit notes that touch U1 files:

- **#6 (P2 advisory)** - `ReviewResultData.inbox_health` added as a required field without a schema_version bump (command-contract.ts:726). No in-repo break (suite green); latent for nonexistent external consumers. Shared with U3/U5.
- **Testing gap** - no test for forged `skill_run_id_provenance: runtime_owned` proving `normalizeReport` strips it. Only `correlation_owned` is tested, and the `runtime_owned` reducer tests construct structs directly, bypassing `normalizeReport`. Add a `normalizeReport` test asserting the stripped field is `undefined`. (testing P1 → folded to gap; the invariant holds in code, only the proof is missing.)

## What's proven

U1's claim-safety invariant is the load-bearing one for the whole plan, and it is sound. Recommend adding the `runtime_owned` strip test before merge to lock the invariant against future regression.
