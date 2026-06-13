# Skill Feedback

The skill-observability feedback loop: durable, structured Software Learning Reports captured at skill closeout and reviewed through agent-native command envelopes. v0 plan: `docs/plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md`. v1 plan: `docs/plans/2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md`.

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

**Verification burden**:
The effort required to prove the skill run's result. V1 stores a sortable level (`none`, `light`, `moderate`, `heavy`) plus a redacted note.
_Avoid_: tests run, confidence, success

**Friction signal**:
The main drag the driver observed during a material skill run. V1 stores one seeded category plus a redacted note.
_Avoid_: complaint, all issues, raw transcript

**Touched surface**:
A skill, reference, doc, runtime package, hook, or labeled area the skill run materially used or affected. V1 treats touched surfaces as optional, caps them at 5, and records no gap when absent. Prefer owner paths; use labels only when no path is known.
_Avoid_: changed file list, transcript topic, vague area

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
The normal-use phase where skill-feedback reports become part of everyday review and triage. It starts only after review/correlation work and true Codex end-to-end proof satisfy the accepted pilot gate.
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

**Review decision surface**:
A command-envelope-backed report-card read result that tells agents why a report is worth opening, what action is safe next, and when no action is needed. The command envelope supplies run identity, continuation, diagnostics, and operational repair hints; `skill-feedback` owns the report-card data vocabulary.
_Avoid_: dashboard, raw dump, generic CLI output

**Review unit**:
The evidence bundle that review classifies as one thing. A linked unit represents one trusted `skill_run_id`; missing, untrusted, or placeholder ids produce one report-local unit.
_Avoid_: report, file, merged row, fuzzy group

**Pattern resolution ledger**:
The primary review-value model for `skill-feedback review`: recurring evidence is grouped into patterns, and each pattern carries its resolution state, evidence quality, owner paths, verification burden, and next safe action. Pattern entries remain untrusted evidence until confirmed against owner source.
_Avoid_: canonical instruction, repair proposal, chronological report list, evidence-quality dashboard

**Pressure pattern**:
A design-pattern name used only when a concrete review pressure has already named a seam. In v2, Facade, Adapter, Strategy, and fixed reducer flow are labels for pressure-tested ownership, not reasons to add abstraction.
_Avoid_: pattern cosplay, GoF by default, framework, decorative abstraction

**ReviewResultData Facade**:
The claim-safe review result Interface that hides reducer internals from JSON, plain output, docs, and future agents. It exposes contract-owned facts: review units, ledger entries, allowed claims, split readiness, and anchor-miss telemetry.
_Avoid_: dashboard, renderer copy, generic API, bag of fields

**Anchor Adapter**:
The internal Adapter that turns report target evidence into canonical anchor facts before ledger reduction. It owns repo-contained path canonicalization, anchor strength, and weak-anchor reasons; it does not own product claim language.
_Avoid_: fuzzy matcher, classifier, taxonomy, grouping heuristic

**Claim Strategy**:
The contract-owned rule set that derives allowed claims from evidence tier, source mix, trusted review-unit state, and readiness facts. It makes renderer language repeatable without letting renderers invent claims.
_Avoid_: badge enum, copy rule, renderer inference, claim prose

**Reducer flow**:
The fixed review pipeline that normalizes evidence, builds review units, adapts anchors, reduces ledger entries, derives claims, derives readiness, and renders. Steps can have internal helpers, but the flow owns locality for claim safety.
_Avoid_: chain of responsibility, hidden gate order, dashboard pipeline

**Failure class**:
A named category for recurring review evidence that describes the kind of failure or friction. Two reports share a failure class when they describe the same problem shape, not just the same owner path or resolution path.
_Avoid_: owner path, resolution status, fuzzy match, recommendation

**Taxonomy gap**:
A failure class for review evidence that does not match the predefined product-native class set. It stays standalone until a known class is assigned or the taxonomy changes.
_Avoid_: other, junk drawer, shadow taxonomy, heuristic merge

**Open signal**:
A review threshold that makes a report worth opening: high verification burden, repeated friction, evidence gaps, unlinked correlation spike, or owner-path observation. Low-signal reports return no-action output.
_Avoid_: open every report, raw inbox count, curiosity click

**Repair candidate**:
A later review-surfaced hypothesis that a skill, reference, context, or runtime owner may need repair. v1 surfaces observations and touched surfaces as evidence; derived repair candidates wait for follow-up work.
_Avoid_: recommendation, instruction, proposal file, source edit

**Correlation status**:
The link quality between capture evidence and closeout enrichment. It is `linked` when a shared Skill run id exists, and `unlinked` when closeout evidence writes without a link.
_Avoid_: match, merge status, certainty

**Correlation health**:
The review lane that summarizes linked and unlinked closeout evidence. Many unlinked closeouts indicate skill-feedback or runtime-adapter inspection, not a target-skill defect.
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
The optional correlation id shared by capture evidence and later closeout enrichment for the same skill run. v1 accepts explicit trusted ids when available and writes unlinked evidence when not available.
_Avoid_: filename, Claude detection id, session id alone, report id

**Cost attribution**:
The report's stance for assigning token and USD cost to a skill run. v1 records unavailable cost as a typed gap; native skill-attributed telemetry belongs to follow-up work unless a trusted source is already present.
_Avoid_: usage, token count, transcript sum

**Inbox**:
The gitignored, repo-local `.skill-feedback/` directory that stores reports as evidence only. Review is mutation-free; purge is a separate gated workflow.
_Avoid_: store, database, log dir, skill state

**Retention warning**:
A review warning emitted when the oldest inbox report is at least 14 days old or the inbox has at least 100 reports. It is guidance for a future gated purge workflow, not a failure.
_Avoid_: purge, deletion, error, archive

**Pilot checkpoint**:
A seven-day review notice started by the first successful v1 closeout. It reports actionable-feedback numerator, denominator, and density, then asks for pilot review until an explicit cleanup command or workflow removes the local marker.
_Avoid_: background scheduler, hidden alarm, permanent warning, purge, manual file delete

**Untrusted evidence**:
The truth stance on every report: evidence a reader weighs, never an instruction an agent obeys. Marked `untrusted_evidence: true`.
_Avoid_: feedback, learnings, recommendation, instruction

**Gitignore gate**:
The pre-write refusal unless `git check-ignore --quiet .skill-feedback/` exits 0. Not-ignored (1) and not-a-repo (128) both refuse.
_Avoid_: gitignore check, grep gate, soft warning

**Actionable-feedback density**:
The pilot's success measure: after 7 days, at least 30% of material closeouts should produce review-classified open evidence or a no-action decision with explicit rationale. Value comes from feedback the agent can act on, not telemetry volume.
_Avoid_: feedback volume, token count, agent self-rating
