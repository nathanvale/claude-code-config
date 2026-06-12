# Report Shape

Source owner: `skills/skill-feedback/src/command-contract.ts`.

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
- `runtime`: allowlisted telemetry.
- `report_card`: closeout evidence lanes.
- `evidence_gaps`: typed missing-or-weak evidence codes.

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
