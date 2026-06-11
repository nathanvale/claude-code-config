# Skill Feedback

The skill-observability feedback loop (v0 pilot): a durable, structured record captured at a finished skill's close and written to a gitignored inbox a human reads by hand. Plan: `docs/plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md`.

## Language

**Capture point**:
The finished-skill close that a Software Learning Report is bound to. A *signal*, not an action — the finished skill signals; the Driver records.
_Avoid_: trigger, auto-trigger, hook (reserve "hook" for the harness-enforced Codex `notify` / Claude Stop mechanism)

**Driver**:
The top-level agent — the only legal caller of `record`. A finished skill never invokes `skill-feedback` itself.
_Avoid_: runner, orchestrator, the finished skill

**Receipt**:
The flat normalized input to `record`, merging adapter-derived telemetry (trusted, never redacted) with agent-narrated free text (untrusted, redaction-gated). The narrated fields are named by the `NARRATED_FIELDS` constant; everything else is telemetry.
_Avoid_: payload, transcript, record (the Receipt is input; the report is output)

**Narrated fields**:
The agent-authored free-text Receipt fields named by the `NARRATED_FIELDS` constant (`goal`, `friction`, `explanation`). The only fields redaction scrubs; telemetry fields are left untouched.
_Avoid_: notes, free text, user input, the whole Receipt

**CaptureAdapter**:
The seam that normalizes one harness's native telemetry into a Receipt. Two ship in v0 (`ClaudeOtelAdapter`, `CodexJsonAdapter`) so the second proves the seam.
_Avoid_: harness shim, telemetry parser, factory, provider

**CaptureResult**:
A CaptureAdapter's discriminated-union output: `receipt` or `degraded`.
_Avoid_: nullable receipt, optional receipt, fallback receipt

**Degraded capture**:
A capture missing required telemetry, written as a typed variant with named reasons and listed gaps. It still writes; the Gitignore gate refuses.
_Avoid_: failed capture, empty record, silent default

**Software Learning Report**:
The written record `record` produces — one flat OpenTelemetry-shaped row inside the success envelope's `data`. v0 carries two lanes: outcome and friction.
_Avoid_: log entry, eval row, transcript, feedback note

**Inbox**:
The gitignored, repo-local `.skill-feedback/` directory a human reads by hand and purges after each review. Holds reports as evidence only.
_Avoid_: store, database, log dir, skill state

**Untrusted evidence**:
The truth stance on every report: evidence a reader weighs, never an instruction an agent obeys. Marked `untrusted_evidence: true`.
_Avoid_: feedback, learnings, recommendation, instruction

**Gitignore gate**:
The pre-write refusal unless `git check-ignore --quiet .skill-feedback/` exits 0. Not-ignored (1) and not-a-repo (128) both refuse.
_Avoid_: gitignore check, grep gate, soft warning

**Actionable-feedback density**:
The pilot's success measure (arXiv 2605.29682): value comes from feedback the agent can act on, not telemetry volume.
_Avoid_: feedback volume, token count, agent self-rating
