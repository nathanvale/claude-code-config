# Report Shape

Source owner: `skills/skill-feedback/src/command-contract.ts`.

## Source Layout

- Keep `skills/skill-feedback/src/` flat.
- Read `command-contract.ts` first for schema versions, contract ids, enums, exported result shapes, and parser rules.
- Read review orchestration in `skill-feedback-runner.ts`.
- Keep CLI orchestration, inbox reads, review dispatch, and rendering glue in `skill-feedback-runner.ts`.
- Read `review-ledger-reducer.ts` for reducer-owned review-unit, ledger-entry, evidence-tier, entry-local claim, and readiness logic.
- Read `ledger-anchor-adapter.ts` for repo-contained path canonicalization, anchor strength, weak-anchor reasons, and strong-only `ledger_anchor_key` facts.
- Put agent-authored string safety in `redaction.ts`.
- Put small shared report helpers in `report-helpers.ts`.
- Put runtime capture adapter lanes in `capture-adapters.ts`.
- Do not create `patterns/`, `gof/`, or pattern-name directories.
- Use GoF labels in prose only when pressure evidence has named the seam.

## Truth Stance

- This report is evidence.
- This report is not canonical skill instruction.
- Agent-authored text is untrusted.
- `untrusted_evidence: true` marks every record.
- Repair source through the owning skill, runtime, or plan.
- Do not store raw transcripts, prompts, cookies, tokens, or auth-bearing URLs.

## V1 Software Learning Report

- `schema_version`: `1`.
- `report_id`: package-owned report id.
- `untrusted_evidence`: `true`.
- `generated_ts`: caller-supplied ISO timestamp.
- `evidence_source`: `hook_capture` or `driver_closeout`.
- `correlation_status`: `linked` or `unlinked`.
- `skill_run_id`: optional explicit runtime correlation id.
- `skill_run_id_provenance`: optional run-link trust label; only `runtime_owned` and `correlation_owned` can coalesce review units.
- `runtime`: allowlisted telemetry.
- `report_card`: closeout evidence lanes.
- `evidence_gaps`: typed missing-or-weak evidence codes.

## V2 Field Ownership

- Keep exact v2 review fields, enum values, parser rules, and result version in `skills/skill-feedback/src/command-contract.ts`.
- Treat `ReviewResultData` as the v2 review result contract; the runner emits it.
- `ReviewResultDataV1` survives only as a type source for reused v1 sub-shapes (`retention`, `pilot_checkpoint`); v2 review output never carries `capture_readiness`.
- Use `SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION` for review output; do not reuse the persisted report schema version for v2 review output.
- Do not copy the v2 review schema into this reference.
- Hook-capture reports may carry `capture_runtime`.
- Hook-capture reports may carry `skill_identity_provenance`.
- Treat `skill_identity_provenance.trusted` as capture-source trust only.
- Do not map `skill_identity_provenance.trusted` directly to Trusted skill identity, Trusted run proof, or `trusted_engine_identity`.
- Review derives shared run units only from `runtime_owned` or `correlation_owned` `skill_run_id_provenance`.
- Review output carries review units, ledger entries, anchor-miss telemetry, open actions, no-action rationale, and claim-specific readiness facts.
- Keep `allowed_claims` entry-local on ledger entries.
- Do not expose top-level `allowed_claims`.
- Do not expose v1 `capture_readiness` in v2 review output.
- Keep hook command trust rules in the implementation plan and hook tests.
- Keep glossary terms in `skills/skill-feedback/CONTEXT.md`.

## V2 Readiness Shape

- `claim_readiness` distinguishes ready, blocked, and evidence-only states.
- `claim_readiness.runtime_capture`, `claim_readiness.trusted_skill_identity`, and `claim_readiness.daily_pilot` are separate facts.
- Missing usage or cost stays an evidence gap, not a readiness blocker.
- Fixture-backed evidence does not open readiness.
- Transcript-only identity evidence does not open Trusted skill identity readiness.
- Notify evidence does not open Codex capture readiness.
- Manual approval attestation can open runtime capture readiness only.
- Daily pilot readiness requires the accepted pilot gate, machine-observable hook approval, and Trusted skill identity evidence.

## Runtime Telemetry

- `git_sha`: engine-read repository revision.
- `skill_version`: engine-read skill version.
- `model`: adapter-read model identity.
- `usage`: adapter-read usage when trusted.
- `cost`: unavailable in v1 review; represented by `cost_unavailable`.

## Report Card

- `skill`: skill identity.
- `outcome`: `confirmed`, `failed`, or `ambiguous`.
- `goal`: redaction-gated driver goal.
- `friction`: seeded category plus redaction-gated note.
- `verification_burden`: sortable level plus redaction-gated note.
- `touched_surfaces`: optional paths or labels; max 5.
- `observations`: optional evidence-only driver notes; max 3.

## Observation

- `kind`: seeded observation category.
- `target`: optional owner path or redaction-gated label.
- `summary`: redaction-gated evidence summary.
- `evidence_basis`: structured basis.
- Reject driver confidence.
- Reject driver severity.
- Reject free-form next action.
- Reject repair instruction.

## V0 Normalization

- Read v0 records through `normalizeReport`.
- Treat v0 records as `source_schema_version: v0`.
- Map v0 `degraded` and `gaps` into typed evidence gaps.
- Filter v0 placeholder friction from review signal.
- Record cost as unavailable.
- Preserve runtime telemetry separately from report-card data.

## Review Output

- Run review through `skill-feedback review`.
- Keep review mutation-free.
- Lead with coverage.
- Count closeout, capture-only, unlinked, and evidence-gap reports.
- Warn when closeout coverage is low.
- Open only high-signal items.
- Use these open reasons: high verification burden, repeated friction, evidence gap, unlinked correlation spike, owner-path observation.
- Keep expected `cost_unavailable`, `unlinked_correlation`, and `missing_runtime_model` gaps out of single-report open items.
- Return no-action output when no high-signal item exists.
- Surface observations and touched surfaces as evidence.
- Do not derive repair candidates in v1.
- Do not delete or mutate inbox files.
- Emit pilot checkpoint data after the marker is at least 7 days old.
- Emit retention age/count and future purge hints without deleting files.
- Warn when the oldest report is at least 14 days old.
- Warn when the inbox has at least 100 reports.

## Reading Rule

- Use reports to find candidate improvements.
- Confirm every proposed instruction change against local source evidence.
- Treat unlinked evidence as correlation health before target-skill quality.
- Keep review mutation-free.
- Run purge through a future gated workflow.
