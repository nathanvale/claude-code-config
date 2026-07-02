# Skill Feedback

The skill-observability feedback loop: durable, structured Software Learning Reports captured at skill closeout and reviewed through agent-native command envelopes.

Current source map:

- v0 capture package: `skills/skill-feedback/docs/plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md`.
- v1 report card and closeout: `skills/skill-feedback/docs/plans/2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md`.
- v2 claim-safe review: `skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md`.
- Review merge hardening: `skills/skill-feedback/docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md`.
- Health command: `skills/skill-feedback/docs/plans/2026-06-15-001-feat-skill-feedback-health-command-plan.md`.
- Writer proof: `skills/skill-feedback/docs/plans/2026-06-24-001-fix-skill-feedback-capture-trust-run-correlation-plan.md`.
- Correlation witnesses: `skills/skill-feedback/docs/plans/2026-06-25-001-feat-skill-feedback-correlation-witnesses-plan.md`.
- Correlation backfill repair: `skills/skill-feedback/docs/plans/2026-06-28-001-fix-skill-feedback-correlation-backfill-plan.md`.
- P0/P1 ownership refactor: `skills/skill-feedback/docs/plans/2026-06-29-001-refactor-skill-feedback-p1-task-list-plan.md`.

## Language

**Capture point**:
The end-of-turn at which a Software Learning Report is fired. Detected at the harness level, not by a skill announcing itself. Claude Stop and Codex Stop are capture points; Codex notify is legacy forwarding evidence only.
_Avoid_: trigger, auto-trigger, the finished skill, `## Close` breadcrumb

**Close detection**:
How a harness hook decides a skill ran this turn. Claude parses the Stop hook's `transcript_path` JSONL for a completed `Skill` tool call and dedupes by detection id. Codex Stop capture exists, but Codex close detection is not trusted until a Trusted skill identity source is proven.
_Avoid_: skill breadcrumb, `## Close` marker, agent recall

**Stop-detected skill**:
A runtime-specific evidence state where a Stop hook can name a completed skill run from that runtime's supported evidence. Claude Code may reach this state through Stop plus transcript evidence; it is stronger than a turn-level Stop capture and weaker than Trusted skill identity.
_Avoid_: trusted skill identity, Codex proof, assistant claim

**Stop-detected turn**:
A runtime evidence state where a Stop hook proves a turn ended and capture ran, but does not prove which skill ran. Codex Stop is currently this state until an engine-owned skill invocation source exists.
_Avoid_: stop-detected skill, skill captured, trusted identity

**Trusted skill identity**:
Engine-owned evidence that a named skill ran during a capture point. Assistant prose, placeholder labels, inferred latest-run matching, and transcript-only evidence do not qualify.
_Avoid_: guessed skill, assistant claim, placeholder skill, latest run

**Driver**:
The top-level agent that may file a closeout for a material skill run. Capture owns `record`; driver closeout owns `closeout`. A finished skill never invokes `skill-feedback` itself.
_Avoid_: runner, orchestrator, the finished skill

**Capture receipt**:
The flat normalized input to `record`, merging adapter-derived telemetry with redaction-gated agent narration from the capture path. Runtime telemetry is allowlisted before write.
_Avoid_: payload, transcript, record (the Receipt is input; the report is output)

**Closeout receipt**:
Driver-authored structured evidence submitted after a material skill run to enrich capture evidence. It can add friction, verification, observations, and touched-surface signal; it never replaces capture.
_Avoid_: self-report, feedback form, transcript summary

**Closeout core**:
The required closeout fields for a non-gap v1 closeout: skill, outcome, goal, friction, and verification burden. Touched surfaces and observations are optional lanes.
_Avoid_: full questionnaire, skill plus outcome only

**Closeout budget**:
The v1 product target that a normal driver can file a useful closeout in about 60 seconds. It shapes schema and guidance; it is not a runtime timer.
_Avoid_: timeout, stopwatch, mandatory essay, unlimited closeout

**Report card**:
The closeout evidence lane inside a Software Learning Report: skill, outcome, goal, friction, verification burden, touched surfaces, and observations. It is driver-authored evidence, not a canonical repair plan.
_Avoid_: instruction, task list, verifier report, raw transcript

**Verification burden**:
The effort required to prove the skill run's result. V1 stores a sortable level (`none`, `light`, `moderate`, `heavy`) plus a redacted note.
_Avoid_: tests run, confidence, success

**Friction signal**:
The main drag the driver observed during a material skill run. V1 stores one seeded category plus a redacted note.
_Avoid_: complaint, all issues, raw transcript

**Touched surface**:
A skill, reference, doc, runtime package, hook, or labeled area the skill run materially used or affected. V1 treats touched surfaces as optional, caps them at 5, and records no gap when absent. Prefer owner paths; use labels only when no path is known.
_Avoid_: changed file list, transcript topic, vague area

**Owner path**:
A repo-relative source path that owns the behavior, vocabulary, contract, or evidence under discussion. Review can anchor strong owner-path evidence; labels stay weaker when no path is known.
_Avoid_: absolute path, filename guess, topic label, display ref

**Observation**:
An optional driver-authored evidence item captured during closeout. V1 caps observations, redacts summaries and labels, validates target paths as repo-relative owner paths, and excludes confidence, severity, next action, and repair instruction fields.
_Avoid_: finding, recommendation, instruction, accepted rule, source change

**Material skill run**:
A skill run that shaped the plan, commands, checks, files, or decision path. V1 closeout is best-effort for material skill runs, not every skill invocation.
_Avoid_: every launch, only failures, background route

**Implementation pilot**:
The build-phase use of closeout reports during v1 implementation, smoke tests, and report-value stress tests. It gathers evidence about the report-card loop without declaring skill-feedback ready for daily workflow use.
_Avoid_: daily pilot, launch, production use, Codex end-to-end proof

**Daily pilot**:
The normal-use phase where skill-feedback reports become part of everyday review and triage. It may run on Claude Code once review/correlation work and the accepted Claude-supported pilot gate pass. Codex remains deferred for Trusted skill identity until an engine-owned skill invocation source exists.
_Avoid_: implementation pilot, smoke test, proof-of-run, closeout experiment

**Codex capture readiness gate**:
The readiness boundary for Codex capture. Runtime capture readiness can pass with Codex Stop capture, exact hook command allowlist, and recorded manual approval attestation when machine-observable approval state is unavailable. Trusted skill identity readiness stays separate and requires engine-owned skill identity evidence. Daily pilot readiness still requires the accepted pilot gate and machine-observable approval. Notify-era evidence can inform the review but never opens this gate.
_Avoid_: Codex smoke, notifier proof, hook worked

**Human review**:
The later inspection of agent-filed reports and telemetry evidence. It is not closeout-time user input, and the report writer never blocks on a human answer.
_Avoid_: human signal, required feedback, satisfaction score, blocking prompt

**Mutation-free review**:
A read operation that summarizes inbox evidence without deleting, editing, or promoting files. Purge is a separate gated workflow.
_Avoid_: cleanup, archive, review-and-delete

**Health command**:
The read-only `skill-feedback health` command that reports inbox operability, readiness, correlation, warnings, and one next action before deeper review. It never deletes, repairs, or exposes healthy repo paths.
_Avoid_: review ledger, purge preview, cleanup, trust badge

**Front-door dashboard**:
The zero-arg human output from `skill-feedback`, also available as
`skill-feedback dashboard`. It is a bounded launch surface over inbox evidence:
reports, usage, improvement queue, and advanced diagnostics. Use
`skill-feedback health` for health-first diagnostics.
_Avoid_: review result, trust badge, repair plan, per-skill verdict, health-only dashboard

**Review decision surface**:
A command-envelope-backed report-card read result that tells agents why a report is worth opening, what action is safe next, and when no action is needed. The command envelope supplies run identity, continuation, diagnostics, and operational repair hints; `skill-feedback` owns the report-card data vocabulary.
_Avoid_: dashboard, raw dump, generic CLI output

**Command facade contract**:
The CLI Interface in `src/command-contract.ts` that owns command discovery, help metadata, parser rules, result contracts, output modes, side-effect posture, and exit-code meaning. Docs point to it instead of copying flags or schemas.
_Avoid_: docs schema, runner copy, help prose, generic CLI

**Review unit**:
The evidence bundle that review classifies as one thing. A linked unit represents a Trusted run proof; missing, untrusted, or placeholder ids produce one report-local unit.
_Avoid_: report, file, merged row, fuzzy group

**Trusted run proof**:
Runtime-owned or correlation-owned evidence that a `skill_run_id` safely links reports for the same skill run. It can support `same_trusted_run`. It supports `corroborated` only when the same trusted review unit has runtime-owned hook capture and a correlation-owned driver closeout. It does not prove Trusted skill identity or `trusted_engine_identity`.
Raw persisted inbox provenance is evidence-only unless a writer-owned source preserved it through normalization.
_Avoid_: raw `skill_run_id`, trusted skill identity, assistant claim

**Writer proof**:
Local HMAC proof that the `skill-feedback` writer owned selected persisted report fields at write time. It can let review preserve writer-owned `skill_run_id_provenance`; it does not prove Trusted skill identity, engine-owned identity, hook-to-closeout correlation, or `corroborated` by itself.
_Avoid_: Trusted run proof, trusted skill identity, keychain proof, correlation proof

**Correlation witness**:
A private signed link artifact under `.skill-feedback/.correlation/` that can connect one runtime-owned Claude Stop hook report to one driver closeout report. Review verifies the witness, both linked report proofs, skill match, writer key, and hook runtime run id before overlaying `correlation_owned` on the closeout. Public closeout receipts cannot create witnesses or set correlation provenance.
Blocked witness finalization may write private `diagnostic_*.json` artifacts under the same directory; these carry diagnostics plus optional private repair candidate boundaries. They never act as reports or closeout input.
_Avoid_: public receipt field, raw transcript match, assistant claim, timestamp match

**Correlation repair**:
The explicit `skill-feedback correlate` workflow that previews blocked witness diagnostics, classifies repairability, and writes missing private witnesses only with `--execute`. It recomputes current private evidence before writing and never trusts public report ids, run ids, proof fields, or closeout receipt fields.
_Avoid_: review repair, health mutation, timestamp backfill, manual trust input

**Trust store**:
The private repo-local `.skill-feedback/.trust/` directory that holds the local writer proof key. Review treats missing, corrupt, unreadable, unsafe, or wrong-permission trust stores as proof-unavailable and keeps reports evidence-only.
_Avoid_: inbox report, source file, public config, portable key

**Proof health**:
Review and health diagnostics for writer proof verification, evidence-only fallback, and same-inbox replay detection. It reports reason ids; it never prints signing keys, key paths, signature inputs, or derived key material.
_Avoid_: readiness badge, trust badge, repair instruction, secret diagnostic

**Review ledger**:
The primary review-value model for `skill-feedback review`: evidence is grouped into review units and ledger entries, and each entry carries resolution state, evidence quality, owner paths, verification burden, and next safe action. Ledger entries remain untrusted evidence until confirmed against owner source.
_Avoid_: canonical instruction, repair proposal, chronological report list, evidence-quality dashboard

**Improvement queue**:
A human-facing list of evidence-backed inspection candidates. It groups by owner path first, defaults to strong or repeated evidence, and uses skill rows only when reports lack a strong owner path. It recommends a next safe action or no-build, not source edits.
_Avoid_: repair plan, auto-fix queue, task list, scoring model, mixed ranking, weak-evidence default

**Skill usage**:
A human-facing summary of which skills produced reports and how those skill runs went. It ranks skills only; owner-path candidates belong in the Improvement queue.
_Avoid_: token usage, cost attribution, owner-path ranking, improvement queue

**Pressure pattern**:
A design-pattern name used only when a concrete review pressure has already named a seam. In v2, Facade, Adapter, and fixed reducer flow are labels for pressure-tested ownership; Strategy stays deferred until claim-rule variation is proven.
_Avoid_: pattern cosplay, GoF by default, framework, decorative abstraction

**ReviewResultData Facade**:
The claim-safe review result Interface that hides reducer internals from JSON, plain output, docs, and future agents. It exposes contract-owned facts: review units, ledger entries with entry-local allowed claims, split readiness, and anchor-miss telemetry.
It also carries minimal inbox status, warning, count, and next-action facts so direct review callers can spot false-empty and degraded-read states before ledger detail.
_Avoid_: dashboard, renderer copy, generic API, bag of fields

**HealthResultData Interface**:
The health result Interface that exposes inbox status, counts, warnings, readiness, proof health, correlation health, and one next action without mutating the inbox. It is owned by `src/command-contract.ts` and emitted by the runner.
_Avoid_: review ledger, purge preview, trust badge, cleanup result

**Branch Station Catalog**:
The package-owned command-branch coverage map in `src/branch-station-catalog.ts`. It names deterministic public command paths that tests and auditors can prove without copying the runner implementation.
_Avoid_: task tracker, manual checklist, arbitrary test list, runtime log

**Report ref**:
A stable navigation reference shaped as `report:<report_id>`. It identifies a Software Learning Report by report id, not by filename.
_Avoid_: file path, content hash, display evidence, prose ref, JSON lookup key

**Allowed claim**:
Entry-local claim language that downstream agents may repeat about one ledger entry. The reducer derives it from trusted review-unit state, anchor facts, evidence tier, source mix, and readiness facts.
_Avoid_: global claim, badge, renderer copy, inferred language

**Claim readiness**:
The review stance for whether a readiness claim is safe to repeat. It separates runtime capture, Trusted skill identity, and Daily pilot readiness. Daily-pilot readiness is runtime-scoped: Claude Code can be supported while Codex Trusted skill identity stays deferred.
_Avoid_: global readiness, capture readiness alias, daily pilot shortcut

**Anchor miss telemetry**:
Weak-anchor counts and attempted target context emitted for later review without grouping. Telemetry explains why labels, missing anchors, out-of-repo paths, or unverifiable targets stayed standalone.
_Avoid_: weak-anchor merge, fuzzy group, taxonomy gap

**Ledger entry**:
The v2 review item that carries one anchor outcome, source mix, evidence tier, entry-local allowed claims, resolution state, verification burden, and next safe action.
_Avoid_: canonical repair, renderer row, raw report

**Anchor Adapter**:
The internal Adapter that turns report target evidence into canonical anchor facts before ledger reduction. It owns repo-contained path canonicalization, anchor strength, and weak-anchor reasons; it does not own product claim language.
_Avoid_: fuzzy matcher, classifier, taxonomy, grouping heuristic

**Claim derivation rules**:
The reducer-owned rules that derive allowed claims from evidence tier, source mix, trusted review-unit state, and readiness facts. They make renderer language repeatable without requiring a standalone Strategy module.
_Avoid_: badge enum, copy rule, renderer inference, claim prose, Strategy module

**Reducer flow**:
The fixed review pipeline that normalizes evidence, builds review units, adapts anchors, reduces ledger entries, derives claims, derives readiness, and renders. Steps can have internal helpers, but the flow owns locality for claim safety.
_Avoid_: chain of responsibility, hidden gate order, dashboard pipeline

**Failure class**:
A historical or future taxonomy category for recurring review evidence that describes the kind of failure or friction. Active v2 grouping uses review units and anchor facts, not failure-class keys.
_Avoid_: owner path, resolution status, fuzzy match, recommendation, active v2 grouping key

**Taxonomy gap**:
A historical or future failure class for review evidence that does not match a product-native class set. It stays outside active v2 scope until product-native taxonomy returns.
_Avoid_: other, junk drawer, shadow taxonomy, heuristic merge, weak-anchor reason

**Open signal**:
A review threshold that makes a report worth opening: high verification burden, repeated friction, evidence gaps, unlinked correlation spike, or owner-path observation. Low-signal reports return no-action output.
_Avoid_: open every report, raw inbox count, curiosity click

**Repair candidate**:
A later review-surfaced hypothesis that a skill, reference, context, or runtime owner may need repair. v1 surfaces observations and touched surfaces as evidence; derived repair candidates wait for follow-up work.
_Avoid_: recommendation, instruction, proposal file, source edit

**Correlation status**:
The link quality between capture evidence and closeout enrichment. It is `linked` when review has a trusted run link from runtime-owned or correlation-owned provenance, and `unlinked` when closeout evidence writes without a verified link.
_Avoid_: match, merge status, certainty

**Correlation health**:
The review lane that summarizes linked and unlinked closeout evidence plus correlation witness diagnostics. Many unlinked closeouts or blocked witnesses indicate skill-feedback or runtime-adapter inspection, not a target-skill defect.
_Avoid_: skill quality, closeout quality, blame

**Agent-authored fields**:
Every free-text or label field supplied by an agent rather than an engine-owned source. V1 names these paths in one owner constant and redaction-gates them before write.
_Avoid_: notes, free text, user input, the whole Receipt

**CaptureAdapter**:
The seam that normalizes one harness's native telemetry into a Receipt. Two ship in v0 (`ClaudeOtelAdapter`, `CodexJsonAdapter`) so the second proves the seam; live hooks do not call the seam until their telemetry source is reachable.
_Avoid_: harness shim, telemetry parser, factory, provider

**CaptureResult**:
A CaptureAdapter output before report normalization. v1 review treats degraded adapter output as typed evidence gaps, not as the source of truth.
_Avoid_: nullable receipt, optional receipt, fallback receipt

**Evidence gap**:
A typed missing-or-weak evidence code carried on a report. Review derives health from gaps instead of treating one degraded boolean as the source of truth.
_Avoid_: failure, empty field, warning string

**Software Learning Report**:
The written evidence record in the skill-feedback inbox. v1 keeps hook capture and driver closeout in this report family, distinguished by Evidence source.
_Avoid_: log entry, eval row, transcript, feedback note

**Runtime support**:
The named runtime target for v1: Claude, Codex, and Cloud. Support comes from shared report-card records, command envelopes, and explicit or unlinked correlation.
_Avoid_: agent agnostic, one-off runtime, guessed identity

**Evidence source**:
The origin lane of a Software Learning Report record, such as hook capture or driver closeout. It explains who or what produced the evidence without making narrated text trusted.
_Avoid_: report type, mode, writer

**Capture runtime**:
The harness provenance for hook-capture evidence, such as Claude Stop, Codex Stop, or Codex notify. Evidence source says hook capture versus driver closeout; capture runtime says which hook family produced the capture.
_Avoid_: evidence source, runtime support, provider

**Skill run id**:
The optional correlation id shared by capture evidence and later closeout enrichment for the same skill run. A raw report-authored id is evidence only; it becomes Trusted run proof only when runtime-owned or correlation-owned provenance establishes the link.
_Avoid_: filename, Claude detection id, session id alone, report id

**Skill run id provenance**:
The report field that says who owns a `skill_run_id` link claim. Raw persisted values are evidence-only at the inbox boundary; only writer-owned or witness-verified provenance preserved through normalization can coalesce review units. Public receipts cannot set it.
_Avoid_: raw id trust, assistant claim, timestamp proximity

**Cost attribution**:
The report's stance for assigning token and USD cost to a skill run. v1 records unavailable cost as a typed gap; native skill-attributed telemetry belongs to follow-up work unless a trusted source is already present.
_Avoid_: usage, token count, transcript sum

**Inbox**:
The gitignored, repo-local `.skill-feedback/` directory that stores reports as evidence only. Review is mutation-free; purge is a separate gated workflow.
_Avoid_: store, database, log dir, skill state

**Low-signal lane**:
The logical inbox lane for valid capture reports that prove capture health but cannot safely enter the primary review ledger. It includes `.skill-feedback/low-signal/` and legacy top-level unknown-skill Codex Stop reports until Trusted skill identity exists.
_Avoid_: junk, discard, primary report, hidden failure

**Inbox health**:
The read summary for primary count, low-signal count, invalid artifacts, and skipped unsafe artifacts. Review and health use it to explain inbox state without mutating files.
_Avoid_: cleanup result, purge result, ledger evidence, report quality

**Inbox status**:
The inbox health field that classifies storage and readability state only. Readiness and correlation carry their own status fields.
_Avoid_: global health, trust badge, report quality, correlation status

**Purge workflow**:
The explicit mutation command for report retention cleanup. It previews first, deletes only selected safe report files through an execute gate, and remains separate from review.
_Avoid_: review cleanup, automatic retention, hidden delete, archive

**Retention warning**:
A review warning emitted when the oldest primary inbox report is at least 14 days old or the primary inbox has at least 100 reports. It is guidance to inspect purge, not a failure.
_Avoid_: purge, deletion, error, archive

**Pilot checkpoint**:
A seven-day review notice started by the first successful v1 closeout. It reports actionable-feedback numerator, denominator, and density. Its `pilot_started_at` marker remains manual source evidence and is not part of purge.
_Avoid_: background scheduler, hidden alarm, permanent warning, purge coupling

**Untrusted evidence**:
The truth stance on every report: evidence a reader weighs, never an instruction an agent obeys. Marked `untrusted_evidence: true`.
_Avoid_: feedback, learnings, recommendation, instruction

**Gitignore gate**:
The pre-write refusal unless `git check-ignore --quiet .skill-feedback/` exits 0. Not-ignored (1) and not-a-repo (128) both refuse.
_Avoid_: gitignore check, grep gate, soft warning

**Actionable-feedback density**:
The pilot's success measure: after 7 days, at least 30% of material closeouts should produce review-classified open evidence or a no-action decision with explicit rationale. Value comes from feedback the agent can act on, not telemetry volume.
_Avoid_: feedback volume, token count, agent self-rating
