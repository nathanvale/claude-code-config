# Architecture Pattern Pressure Lens Ideation

Source: Codex conversation on 2026-06-14.

## Context

The existing `gof-pressure-lens` skill is useful as a GoF pattern referee, but
the agent-worktree and SideQuest work exposed broader architecture pressure:
failure recovery, evidence cascades, CLI contracts, operation journals, read
projections, and agent handoffs.

The core improvement is not a larger pattern catalog. It is pressure-first
routing:

1. Identify the dominant architecture pressure.
2. Choose the relevant pattern family.
3. Keep, reject, or defer pattern names against evidence.
4. Scaffold only when the pattern earns an owner path and deletion test.

## Strongest Idea

Broaden `gof-pressure-lens` into an architecture-pattern pressure lens.

GoF stays as one catalog, not the default catalog.

### Purpose

- Referee pattern names.
- Route pressure to the right pattern family.
- Reject decorative architecture.
- Produce scaffoldable seams only when pressure is earned.

## Pattern Families

| Pressure | Better Pattern Families |
| --- | --- |
| Object collaboration | GoF |
| Domain ownership | DDD, bounded context, aggregate, domain service |
| IO/runtime boundary | Ports and adapters, hexagonal, anti-corruption layer |
| CLI/API drift | Contract-first, facade, schema envelope |
| Recovery/failure | Saga, compensating action, state machine, operation journal |
| Evidence cascade | Pipeline, chain, decision table |
| Read-heavy context | CQRS, projection, read model |
| Audit/replay | Event log, event sourcing-lite |
| Safety gates | Policy object, rules table, guard clause pipeline |
| Migration | Strangler fig, branch by abstraction |
| Multi-agent handoff | Blackboard, workflow engine, durable continuation |

## First Question

Before naming patterns, ask:

> What pressure is dominant?

Options:

- Object design
- Domain model
- Runtime boundary
- Failure recovery
- CLI contract
- State flow
- Auditability
- Read projection
- Migration path
- Agent handoff

## Pressure Gate

Keep the existing gate, but make it catalog-agnostic:

- Pressure source
- Seam
- Owner path
- Deletion-test consequence
- Locality or leverage gain
- Next safe action

If any field is absent, stop naming patterns and route to the owner workflow.

## Misfit Table

Use this to prevent familiar names from hiding the real pressure:

| Candidate | Reject When |
| --- | --- |
| Strategy | The real shape is a decision table or policy map. |
| Chain of Responsibility | The cascade is fixed, deterministic, and not handler-owned. |
| Observer | The need is auditability or replay, not subscriber notification. |
| Command | The need is CLI contract stability, not objectified actions. |
| Facade | No external caller contract or drift pressure exists. |
| Template Method | The variation is data/configuration, not subclass behavior. |

## Output Shape

Return:

- Dominant pressure
- Candidate pattern families
- Kept patterns
- Rejected patterns
- Deferred patterns
- Non-GoF labels
- Scaffold recommendation
- Owner path
- Deletion test
- Next safe action

## V2 Shape

Preferred route:

- `architecture-pattern-pressure-lens` owns pressure routing.
- `gof-pressure-lens` becomes a thin GoF catalog reference.
- Future references can cover:
  - `ddd-patterns.md`
  - `recovery-patterns.md`
  - `contract-patterns.md`
  - `event-patterns.md`

Avoid for v2:

- Big universal pattern encyclopedia.
- Cold repo-wide pattern scan.
- Runtime validator.
- Pattern scoring formula.

## Product Principle

Pressure first. Catalog second. Scaffold only when earned.
