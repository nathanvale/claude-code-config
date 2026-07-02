# Report Shape

Source owners: `skills/skill-feedback/src/command-contract.ts`,
`skills/skill-feedback/src/runtime-contract.ts`,
`skills/skill-feedback/src/runtime-file-safety.ts`,
`skills/skill-feedback/src/raw-object.ts`,
`skills/skill-feedback/src/decision-surface.ts`,
`skills/skill-feedback/src/report-normalizer.ts`,
`skills/skill-feedback/src/inbox-read-model.ts`,
`skills/skill-feedback/src/correlation-witness-artifacts.ts`,
`skills/skill-feedback/src/correlation-witness-workflow.ts`,
`skills/skill-feedback/src/review-ledger-reducer.ts`,
`skills/skill-feedback/src/ledger-anchor-adapter.ts`,
`skills/skill-feedback/src/report-helpers.ts`, and
`skills/skill-feedback/src/skill-feedback-runner.ts`.

## Source Layout

- Keep `skills/skill-feedback/src/` flat.
- Read `command-contract.ts` first for schema versions, contract ids, enums, exported result shapes, and parser rules.
- Read `runtime-contract.ts` for `ReadTargetResolution`, `StdinTelemetry`, and `SkillFeedbackRuntime`.
- Read `runtime-file-safety.ts` for shared path containment, optional lstat, safe realpath, private-mode, and Node error-code helpers.
- Read `raw-object.ts` for shared unknown JSON string-field and duplicate-string helpers.
- Read `decision-surface.ts` for review and health result assembly, warnings, next action, readiness, retention, pilot checkpoint, and read-target projection.
- Read `report-normalizer.ts` for persisted report parsing, proof-context application, and cost-unavailable projection.
- Read `inbox-read-model.ts` for safe scans, raw report reads, duplicate/proof facts, low-signal classification, health facts, and purge candidates.
- Read `correlation-witness-artifacts.ts` for witness and diagnostic artifact schemas, safe correlation directory reads, diagnostic writes, and repair-candidate classification.
- Read `correlation-witness-workflow.ts` for finalization, verification overlay, repair classification, and execute orchestration.
- Read review and health orchestration in `decision-surface.ts` and `skill-feedback-runner.ts`.
- Keep default runtime wiring, CLI orchestration, review/health dispatch, explicit writes, and rendering glue in `skill-feedback-runner.ts`.
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
- `skill_run_id`: optional run-link id assigned by writer-owned runtime proof or witness verification.
- `skill_run_id_provenance`: optional run-link trust label; raw persisted values are evidence-only at the inbox boundary.
- `runtime`: allowlisted telemetry.
- `report_card`: closeout evidence lanes.
- `evidence_gaps`: typed missing-or-weak evidence codes.

## V2 Software Learning Report

- `schema_version`: `2`.
- Shared persisted shape for hook capture and driver closeout.
- Carries top-level `skill` for writer-owned proof payloads.
- May carry `writer_proof` from the local writer.
- A valid `writer_proof` proves selected writer-owned fields only.
- A valid `writer_proof` does not prove Trusted skill identity.
- A valid `writer_proof` does not prove hook-to-closeout correlation by itself.
- Correlation witnesses live under `.skill-feedback/.correlation/`; they are signed link artifacts, not reports.
- Correlation diagnostics live under `.skill-feedback/.correlation/diagnostic_*.json`; they carry diagnostics plus optional private repair candidate boundaries. They are not reports or public receipt input.
- Correlation repair candidates come only from private diagnostic artifacts plus validated inbox reports.
- Review scans `.skill-feedback/.correlation/` through witness validation and skips it during normal report scans.
- Purge skips `.skill-feedback/.correlation/` witness and diagnostic artifacts.
- Missing or invalid proof keeps raw `skill_run_id_provenance` evidence-only.
- Schema `1` and v0 reports remain readable as evidence-only.
- `.skill-feedback/.trust/` is the private trust store, not a report lane.
- Review and purge scanners skip `.skill-feedback/.trust/` by path.

## V2 Field Ownership

- Keep exact v2 review fields, enum values, parser rules, and result version in `skills/skill-feedback/src/command-contract.ts`.
- Keep runtime and read-target interfaces in `skills/skill-feedback/src/runtime-contract.ts`.
- Keep review and health result assembly in `skills/skill-feedback/src/decision-surface.ts`.
- Keep persisted report normalization in `skills/skill-feedback/src/report-normalizer.ts`.
- Keep safe inbox read facts in `skills/skill-feedback/src/inbox-read-model.ts`.
- Keep correlation artifact IO and diagnostic classification in `skills/skill-feedback/src/correlation-witness-artifacts.ts`.
- Keep correlation witness workflow behavior in `skills/skill-feedback/src/correlation-witness-workflow.ts`.
- Treat `ReviewResultData` as the v2 review result contract; `decision-surface.ts` assembles it and the runner emits it.
- Treat `HealthResultData` as the health result contract; `decision-surface.ts` assembles it and the runner emits it.
- `ReviewResultDataV1` is legacy compatibility vocabulary only; v2 review output never carries `capture_readiness`.
- Use `SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION` for review output; do not reuse the persisted report schema version for v2 review output.
- Use `SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION` for health output; do not reuse review or persisted report schema versions.
- Do not copy the v2 review schema into this reference.
- Do not copy the health schema into this reference.
- Hook-capture reports may carry `capture_runtime`.
- Hook-capture reports may carry `skill_identity_provenance`.
- Treat `skill_identity_provenance.trusted` as capture-source trust only.
- Do not map `skill_identity_provenance.trusted` directly to Trusted skill identity, Trusted run proof, or `trusted_engine_identity`.
- Review derives shared run units only after a writer-owned source or verified correlation witness has preserved trusted run proof through normalization.
- `normalizeReport` in `skills/skill-feedback/src/report-normalizer.ts` strips raw inbox `skill_run_id_provenance` unless proof context is verified; raw JSON cannot mint `same_trusted_run`, `correlation_owned`, or `corroborated`.
- Keep exact health projection fields, enum values, reason ids, and next-action ids in `skills/skill-feedback/src/command-contract.ts`.
- Keep exact correlate result fields, reason ids, candidate classes, and action ids in `skills/skill-feedback/src/command-contract.ts`.
- Keep `allowed_claims` entry-local on ledger entries.
- Do not expose top-level `allowed_claims`.
- Do not expose v1 `capture_readiness` in v2 review output.
- Keep hook command trust rules in the implementation plan and hook tests.
- Keep glossary terms in `skills/skill-feedback/CONTEXT.md`.

## V2 Readiness Shape

- `claim_readiness` distinguishes ready, blocked, and evidence-only states.
- `claim_readiness.runtime_capture`, `claim_readiness.trusted_skill_identity`, `claim_readiness.daily_pilot`, `claim_readiness.claude_daily_pilot`, and `claim_readiness.codex_trusted_skill_identity` are separate facts.
- Treat `claim_readiness.daily_pilot` as the current supported-runtime pilot alias; use `claim_readiness.claude_daily_pilot` for explicit Claude-supported claims.
- Missing usage or cost stays an evidence gap, not a readiness blocker.
- Fixture-backed evidence does not open readiness.
- Transcript-only identity evidence does not open Trusted skill identity readiness.
- Notify evidence does not open Codex capture readiness.
- Manual approval attestation can open runtime capture readiness only.
- Claude-supported daily-pilot readiness requires the accepted pilot gate and Claude-side supported runtime evidence. Codex Trusted skill identity remains a separate deferred claim until Codex ships an engine-owned skill invocation source.

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

## Command Envelope

- Machine-readable commands emit a JSON process envelope for automation.
- `dashboard` success output is bounded plain text; use `health` for the
  machine-readable envelope over the same health facts.
- Do not add dashboard JSON output or a dashboard JSON alias to health.
- Success envelopes carry `status`, `run_id`, `data`, `runtime_actions`, and `continuation`.
- Command identity and schema version live in `data.contract` and `data.schema_version`.
- Error envelopes carry `status: "error"`, `data.changed_state`, `data.contract`, `data.schema_version`, and `error` fields.
- Error fields include code, message, exit code, recoverability, retryability, hint, and failure domain.
- Exit `1` means repair-state unless the envelope names a narrower cause.
- Exit `2` means input repair such as usage, argv, or stdin shape.
- `reports`, `report`, `usage`, and `queue` default to bounded plain output.
- Keep JSON output available for `reports`, `report`, `usage`, and `queue`.

## Review Output

- Run review through `skill-feedback review`.
- Keep review mutation-free.
- Apply verified correlation witnesses before reducing review units.
- Lead plain review with health state, top warning, and next action.
- Treat review JSON as the full evidence source.
- Treat `review --plain` as bounded by default.
- Use `full_evidence=json` as the pointer to complete open item, open action,
  engineering signal, and ledger arrays.
- Read `truncated_open_actions`, `truncated_engineering_signals`, and
  `truncated_ledger_entries` as omitted row counts.
- Read row-local `evidence_refs_omitted` as omitted evidence refs for that row.
- Read open-action rows from `- action=<key> next=<text> evidence=<refs>`.
- Read engineering-signal rows from
  `- signal=<key> reason=<reason> owner=<path> evidence=<refs>`.
- Treat `engineering_signals` as derived review ledger evidence, not a repair
  instruction.
- Expect one signal per open owner path after ledger merge; review JSON is the
  complete source when plain output truncates rows or evidence refs.
- Read ledger rows from `- owner=<path|unknown>`.
- Count closeout, capture-only, unlinked, and evidence-gap reports.
- Count only primary reports in coverage.
- Keep unknown-skill Codex Stop capture in the low-signal lane.
- Treat low-signal as a logical lane: `.skill-feedback/low-signal/` plus legacy top-level unknown-skill Codex Stop reports.
- Use low-signal evidence for capture-health/readiness context only.
- Emit `inbox_health` for primary count, low-signal count, per-report low-signal reason ids, skipped unsafe artifacts, and invalid artifacts.
- Emit `proof_health` without mutating inbox files.
- Emit `correlation_witnesses` without mutating inbox files.
- Treat duplicate `report_id` and duplicate `writer_proof.nonce` values in the same inbox as replay diagnostics.
- Exclude duplicated reports from trusted provenance preservation.
- Use `unknown_skill_codex_stop` for unknown-skill Codex Stop reports.
- Use `low_signal_lane_report` for reports treated as low-signal only because they live in `.skill-feedback/low-signal/`.
- Warn when closeout coverage is low.
- Open only high-signal items.
- Use these open reasons: high verification burden, repeated friction, evidence gap, unlinked correlation spike, owner-path observation.
- Treat `report:<id>` values in `evidence_refs` as report-id refs, not filenames.
- Resolve `report:<id>` first through `review_units[*].report_ids`; scan safe inbox JSON by `report_id` only when raw report content is needed.
- Use `skill-feedback report <id>` as the human report-ref resolver once the human dashboard MVP lands.
- Resolve primary-lane reports by default in report detail.
- Require explicit low-signal lane opt-in before rendering a low-signal-only report detail.
- Do not add a generic `show` or `resolve-ref` command until another ref family proves the command surface is worth owning.
- Treat interrupted `.json.tmp-*` artifacts as invalid inbox health only; purge does not delete them.
- Keep expected `cost_unavailable`, `unlinked_correlation`, and `missing_runtime_model` gaps out of single-report open items.
- Return no-action output when no high-signal item exists.
- Surface observations and touched surfaces as evidence.
- Do not derive repair candidates in v1.
- Keep skill usage rankings skill-only.
- Route owner-path rankings to the human improvement queue.
- Derive the human improvement queue from existing review ledger evidence first.
- Group queue rows by owner path first.
- Use skill queue rows only when reports lack a strong owner path.
- Default queue output to strong or repeated evidence.
- Require explicit opt-in before rendering weak or sparse queue rows.
- Label weak queue rows as weak when explicitly included.
- Defer a standalone report-scoring model until review ledger evidence cannot answer the queue question.
- Do not delete or mutate inbox files.
- Emit pilot checkpoint data after the marker is at least 7 days old.
- Keep `pilot_started_at` as manual source evidence; purge does not delete it.
- Emit retention age/count and purge hints without deleting files.
- Warn when the oldest report is at least 14 days old.
- Warn when the inbox has at least 100 reports.
- Run deletion only through `skill-feedback purge`.
- Keep exact purge flags and selectors in command help and contract tests.
- Treat purge preview as a current candidate listing, not an execute token.
- Evaluate age selectors at current run time for each purge invocation.
- Default purge lane is `all`; `keep_latest` applies across the selected logical lane.

## Correlate Output

- Run correlate through `skill-feedback correlate`.
- Preview is the default mode.
- Support `--plain` for compact human reading.
- Support `--repo <path>` through the same read-target resolver as review and health.
- Execute writes only to the resolved target repo.
- Execute uses `--execute` and recomputes current private evidence before writing.
- Keep public input closed to report ids, run ids, witness ids, proof fields, trust fields, and correlation provenance.
- Emit report refs as `report:<id>`, not filenames.
- Classify candidates as repairable, ambiguous, invalid, already linked, or insufficient evidence.
- Treat sparse historical diagnostics as insufficient evidence unless a private durable candidate source proves the same runtime boundary.
- Route ambiguous, invalid, or failed repair candidates to blocker inspection before retrying execute.
- Write only private witness or diagnostic artifacts under `.skill-feedback/.correlation/`.
- Keep review and health mutation-free; correlate is the only repair workflow.
- Treat all-insufficient preview output as terminal for current evidence.

## Health Output

- Run health through `skill-feedback health`.
- Keep health mutation-free.
- Emit JSON by default.
- Support `--plain` for compact human reading.
- Use zero-arg `skill-feedback` or `skill-feedback dashboard` for the bounded
  human dashboard.
- Keep dashboard rows derived from `HealthResultData`; do not add separate trust
  claims there.
- Support `--repo <path>` through the same read-target resolver as review.
- Do not fall back from a failed explicit `--repo` to caller cwd.
- Do not expose absolute `repo_root` or `inbox_path` in healthy success data.
- Emit `inbox_status` from the enum owned by `skills/skill-feedback/src/command-contract.ts`.
- Return exit 0 for missing and empty valid-repo inbox states.
- Return exit 1 for unsafe inbox roots.
- Count primary, low-signal, invalid, skipped unsafe, and unlinked primary reports.
- Reuse the safe inbox scan path shared by review and purge.
- Treat low-signal as capture-health evidence only.
- Summarize runtime capture, Trusted skill identity, and Daily pilot readiness separately.
- Summarize Claude daily-pilot support and Codex Trusted skill identity separately in plain output.
- Summarize primary correlation using the enum owned by `skills/skill-feedback/src/command-contract.ts`.
- Summarize proof health using reason ids only.
- Summarize correlation witness health diagnostics using reason ids only.
- Use correlate preview for repair candidate boundaries from private diagnostic artifacts.
- Route blocked correlation witness diagnostics to correlate preview.
- Warn when all primary evidence is unlinked.
- Warn when low-signal capture volume reaches the runtime-inspection threshold.
- Warn when retention age/count is ready for explicit purge preview.
- Emit one next action id and summary.
- Never delete, repair, call correlate execute, or call purge helpers.

## Reading Rule

- Use reports to find candidate improvements.
- Confirm every proposed instruction change against local source evidence.
- Treat unlinked evidence as correlation health before target-skill quality.
- Use health before review when inbox operability or capture readiness is unclear.
- Keep review mutation-free.
- Run purge as a separate explicit mutation workflow.
