# ICA Candidate Factory

Use Candidate Factory mode when the user asks to discover architecture
candidates, cross-package opportunities, entropy audit, or custom lanes such as
shared tooling. If the user asks for prompt material for already-known
candidates, use Prompt Pack Only instead. In Standard Seam Swarm mode, include
candidate backlog only when the shard or mode explicitly assigns Candidate
Factory output.

Candidate Factory produces candidates, not plans. For each candidate, emit
evidence, likely owner, ICA framing, confidence, and a follow-up prompt. Do not
sketch a solution Interface, write ADR text, promote vocabulary into
CONTEXT.md, or propose implementation steps.

## Grill-With-Docs Routing

Use `grill-with-docs` as the follow-up prompt when the candidate would change
durable project language or governance:

- Vocabulary candidates whose term, owner, or meaning is disputed.
- Ownership ambiguity candidates that may update package CONTEXT.md,
  AGENTS.md, package maps, or an ADR.
- Derived ADR follow-ups where another lane exposed a hard-to-reverse,
  surprising trade-off.

Do not route ordinary DRY, Interface narrowing, or implementation-plan
candidates through `grill-with-docs` unless their owner or vocabulary must be
resolved first. In those cases, the follow-up prompt should ask one decision
question, cite the evidence and current docs to read, and stop before drafting
the durable doc change.

## Core Entropy Lanes

- **Repetition / DRY Candidate**: repeated branches, projections, handoff
  shapes, adapters, or variants where a shared Interface would improve Locality
  or Leverage. Do not report ordinary duplication.
- **Vocabulary Candidate**: overloaded terms, missing language, competing
  names, or concepts that need a clearer owner before implementation changes.
- **Ownership Ambiguity Candidate**: unclear owner, misplaced policy, split
  responsibility, or behavior whose owning Module is not obvious.
- **Missing Seam Candidate**: a concern leaking across Modules that deserves
  its own Seam.
- **Public Interface Width Candidate**: exported or caller-facing surface wider
  than the Implementation depth it protects.

User-specified lanes are allowed when the user names a concern such as shared
tooling, branch dryness, test-surface friction, runtime output shape, or another
project-specific pattern. Treat those as run-local lenses, not generic skill
vocabulary.

ADR candidates are derived, not a core lane. Nominate an ADR follow-up only
when another lane exposes a hard-to-reverse, surprising trade-off with durable
ownership value.

## Candidate Score

Require each candidate to include:

- **Lane**: one core entropy lane, one user-specified lane, or derived ADR
  follow-up.
- **Evidence strength**: one file only, repeated across files, or independently
  confirmed by tests/docs/ADRs.
- **ICA framing**: why this affects Interface, Depth, Seam, Leverage, Locality,
  Adapter placement, or the deletion test.
- **Owner ambiguity**: clear owner, disputed owner, or no owner.
- **Blast radius**: local Module, package seam, public Interface, or
  cross-package contract.
- **Confidence**: low, medium, or high, with low-confidence candidates dropped
  unless explicitly requested.
- **Follow-up prompt**: the next prompt for `grill-with-docs`, ICA grilling,
  ADR drafting, package-context deepening, a focused implementation plan,
  runbook update, or no action.

Prefer candidates with owner ambiguity, cross-module blast radius, public
Interface consequences, or repeated Interfaces whose consolidation would improve
Locality / Leverage. Drop ordinary cleanup, taste-only feedback, and anything
without a useful next prompt.
