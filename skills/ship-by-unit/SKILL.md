---
name: ship-by-unit
description: "Triggers on 'ship by unit', 'execute the plan unit by unit', 'one commit per unit', 'make this branch reviewable by unit'. Executes a ce-plan one implementation unit at a time, each unit landing exactly one U-ID-tagged commit so the branch becomes unit-review-compatible."
---

# Ship by Unit

Execute a `ce-plan`-style plan so the resulting branch has **one atomic commit per implementation unit**, each scoped and self-contained. This is the upstream half of the unit-review pair: a branch built this way is what makes per-unit fan-out review efficient and trustworthy.

This skill owns the **discipline contract**, not the execution mechanics. Delegate the actual unit work to `ce-work` (serial subagents) — this skill enforces commit boundaries on top.

## Why

Per-unit review is only efficient when each unit is one reviewable commit. If execution lands a feature as 3 messy commits or one blob, the review skill can't scope reviewers and degrades to a whole-diff pass. Enforcing the boundary at *execution* time is cheaper than reconstructing units at review time.

## Preconditions (fail closed)

- A plan with an `## Implementation Units` section (U-IDs) exists. No plan → this skill doesn't apply; run `/ce-plan` first or fall back to plain `ce-work`.
- On a feature branch, never a protected branch. Branch first if needed (repo git policy).
- The user has approved executing the plan (don't auto-execute an analysis-only request).

## The contract (the invariant this skill guarantees)

1. **One commit per unit.** Each unit lands exactly one commit. Not zero (squashed in with a neighbour), not many (WIP dribbles). If a unit genuinely needs splitting, it was mis-sized — note it, don't silently emit 3 commits.
2. **U-ID in the commit subject.** `feat(scope): <subject> (U3)` or `(DEC-049 U2)`. This is the signal `unit-review`'s gate keys on to map commits→units 1:1.
3. **Conventional commit**, repo convention respected, no attribution footers on incremental commits (repo git rules).
4. **Tests green before the commit.** A unit commits only when its verification passes. A red unit blocks the next — do not stack units on a broken tree.
5. **Dependency order.** Execute units respecting the plan's blockers; a dependent unit starts only after its prerequisites have committed.

## Flow

`ce-work` owns execution — subagent dispatch, serial vs parallel, worktree isolation, the parallel-safety check, per-unit staging/commit, and test-as-you-go. Do not restate or re-derive that here. This skill runs `/ce-work` against the plan and enforces the contract above on its output.

1. **Parse the plan** → ordered unit list with U-IDs, files, dependencies, verification.
2. **Run `/ce-work`** to execute the plan. It already executes units in dependency order with fresh-context subagents and incremental commits. The one thing it does NOT guarantee is the strict one-commit-per-unit + U-ID-in-subject invariant — that is what this skill adds: before each unit's commit, confirm the commit covers exactly one unit and its subject carries the U-ID; after the run, confirm commit count == unit count (or documented splits).
3. **On completion**, verify the branch passes the `unit-review` gate (commits map 1:1 to units, U-IDs present). Offer to run `/unit-review`.

## Boundary cases

- **Unit larger than expected** → it may need >1 commit. That's a planning smell. Surface it: "U5 split into 5a/5b because X" and tag both, rather than pretending one commit covered it. The review gate tolerates a documented split; it can't tolerate a silent blob.
- **Unit already shipped** (files exist, verification already passes on a prior branch/session) → verify it matches intent, mark done, do NOT reimplement or emit an empty commit.
- **Pre-existing uncommitted changes** in the tree unrelated to the plan → do not fold them into unit commits. Leave them or ask; a unit commit must contain only that unit.

## Relationship to other skills

- `ce-plan` produces the plan (units, U-IDs) this consumes.
- `ce-work` provides the execution engine (serial subagents, test-as-you-go). This skill is the commit-discipline layer over it — it does not reimplement execution.
- `unit-review` consumes the output. The contract above is exactly its gate's input.

## Anti-goals

- Don't re-author `ce-work`'s execution loop here — delegate it.
- Don't squash at the end "to clean up" — that destroys the per-unit boundary the review depends on. The atomic commits ARE the deliverable.
- Don't enforce this on non-plan work; a typo fix doesn't need a unit contract.
