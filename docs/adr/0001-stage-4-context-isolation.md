---
status: accepted
date: 2026-05-21
---

# Stage 4 Preserves Bounded Orchestrator Context Isolation

Issue-to-PR Stage 4 dispatches a fresh Builder sub-agent for every Builder attempt and keeps implementation reasoning out of the Orchestrator context. The Orchestrator owns host readiness, ledger lifecycle state, Work Packet assembly, envelope validation, and Validator dispatch; Builder owns one confirmed batch attempt; Validators own correctness review. The Orchestrator may read full commit diff content for authority checks, envelope integrity, and lightweight correctness sanity checks, but sanity concerns may only annotate Validator focus. They do not become Orchestrator-authored findings or correctness gates. This favors host-neutral handoff, safer resumes, and bounded context growth while still letting the Orchestrator catch malformed or suspicious Builder returns before Validator handoff.

## Consequences

- Host readiness is checked before every Builder dispatch, after selecting an eligible pending batch and before marking it `in-progress`.
- A host readiness failure records `host-builder-tools-unavailable` without marking a batch `in-progress`.
- A post-dispatch host, schema, or envelope failure records `builder-infrastructure-failure`, leaves the batch `in-progress`, and surfaces side effects for user choice.
- Builder Work Packets contain batch-only state, not the full plan, full ledger, unrelated batches, or raw Validator envelopes.
- Orchestrator may inspect full commit diff content for authority checks, envelope integrity, and lightweight correctness sanity checks.
- Orchestrator correctness sanity concerns may only annotate transient Validator focus; Validators own findings and correctness gates.
- Orchestrator gates before Validator dispatch only when the diff shows a Builder authority breach or malformed envelope, not for correctness concerns alone.
- Validator handoff uses commit refs or ranges, touched file names, batch contract, and Builder evidence; persona selection must not depend on Orchestrator implementation analysis.
