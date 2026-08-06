---
status: accepted
date: 2026-05-21
---

# Stage 4 Preserves Bounded Orchestrator Context Isolation

Issue-to-PR Stage 4 dispatches a fresh Builder sub-agent for `tdd`, `proof_first`, and any repair attempt, and for `change_first` attempts that exceed inline eligibility. The Orchestrator may implement a `change_first` attempt inline only while bounded (the batch is not a patch-batch, <=2 touched files, obvious, low-risk, non-behavioural, non-governance, non-public-contract, no broad discovery, no heavy Orchestrator context load, and not the third consecutive inline attempt without an explicit user-confirmed exception); inline attempts are recorded as Orchestrator-inline evidence in their own audit lane on the ledger, separate from Builder attempt evidence. Implementation reasoning stays out of the Orchestrator context for every Builder dispatch. The Orchestrator owns host readiness, ledger lifecycle state, Work Packet assembly, envelope validation, inline evidence validation, and Validator dispatch; Builder owns one confirmed batch attempt under the Builder dispatch contract; Validators own correctness review for every committed implementation attempt (Builder envelope or Orchestrator-inline). The Orchestrator may read full commit diff content for authority checks, envelope integrity, inline evidence integrity, and lightweight correctness sanity checks, but sanity concerns may only annotate Validator focus. They do not become Orchestrator-authored findings or correctness gates. An open P0/P1 after any committed implementation attempt routes to Builder-only repair, never inline. This favors host-neutral handoff, safer resumes, and bounded context growth while still letting the Orchestrator catch malformed or suspicious attempt evidence before Validator handoff.

## Consequences

- Host readiness is checked before every Stage 4 implementation attempt (Builder dispatch or Orchestrator-inline), after selecting an eligible pending batch and before marking it `in-progress`.
- A host readiness failure records `host-builder-tools-unavailable` without marking a batch `in-progress`.
- A post-dispatch host, schema, or envelope failure records `builder-infrastructure-failure`, leaves the batch `in-progress`, and surfaces side effects for user choice.
- `tdd`, `proof_first`, any repair after an open P0/P1, and every attempt on a patch-batch (which carries an open final-review P0/P1 forward) must dispatch Builder; inline-eligible `change_first` may stay Orchestrator-inline only while every bound holds, and falls back to Builder dispatch as soon as a dispatch trigger fires.
- Builder Work Packets contain batch-only state, not the full plan, full ledger, unrelated batches, or raw Validator envelopes.
- Orchestrator may inspect full commit diff content for authority checks, Builder envelope integrity, Orchestrator-inline evidence integrity, and lightweight correctness sanity checks.
- Orchestrator correctness sanity concerns may only annotate transient Validator focus; Validators own findings and correctness gates.
- Orchestrator gates before Validator dispatch only when the diff or attempt evidence shows an authority breach, malformed Builder envelope, or malformed Orchestrator-inline evidence, not for correctness concerns alone.
- Validator handoff uses commit refs or ranges, touched file names, batch contract, and the real attempt evidence source (Builder envelope evidence or Orchestrator-inline evidence); persona selection must not depend on Orchestrator implementation analysis.
