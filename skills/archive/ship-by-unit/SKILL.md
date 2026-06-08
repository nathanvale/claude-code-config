---
name: ship-by-unit
description: "Triggers on 'ship by unit', 'execute the plan unit by unit', 'one commit per unit', 'make this branch reviewable by unit'. Executes a ce-plan one implementation unit at a time, each unit landing exactly one U-ID-tagged commit so the branch becomes unit-review-compatible."
---

# Ship by Unit

Execute a `ce-plan`-style plan so the resulting branch has **one atomic commit per implementation unit**, each scoped and self-contained. This is the upstream half of the unit-review pair: a branch built this way is what makes per-unit fan-out review efficient and trustworthy.

This skill owns the **discipline contract** and drives the execution loop. It dispatches one fresh-context implementation subagent per unit (a `general-purpose` agent — `ce-work` is a *skill*, not a dispatchable `subagent_type`), and keeps the commit boundary for itself: the subagent implements and verifies; the orchestrator stages and commits.

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

This skill runs the loop directly. Borrow `ce-work`'s *patterns* (fresh-context subagent per unit, dependency order, test-as-you-go) by reading its SKILL.md if useful — but do NOT invoke `/ce-work`, which runs its own commit loop and would break the one-commit-per-unit boundary.

1. **Parse the plan** → ordered unit list with U-IDs, files, dependencies, verification.
2. **Per unit, in dependency order:**
   a. Dispatch one fresh-context `general-purpose` subagent scoped to that unit. Give it the exact files, the pattern to mirror, the tests to add, the verification command — and a **hard scope rule** (see Boundary cases): edit ONLY the unit's listed files; never touch the plan doc or another unit's files; do NOT commit.
   b. When it returns, **verify independently** — re-run the unit's tests/typecheck yourself (don't trust the subagent's word), and review the diff.
   c. **Check scope before committing:** `git status` must show only the unit's files. Revert any stray edits (`git checkout <stray>`), then stage *specific* files and commit with the U-ID in the subject.
3. **On completion**, verify the branch passes the `unit-review` gate (commits map 1:1 to units, U-IDs present). Offer to run `/unit-review`.

## Boundary cases

- **Unit larger than expected** → it may need >1 commit. That's a planning smell. Surface it: "U5 split into 5a/5b because X" and tag both, rather than pretending one commit covered it. The review gate tolerates a documented split; it can't tolerate a silent blob.
- **Unit already shipped** (files exist, verification already passes on a prior branch/session) → verify it matches intent, mark done, do NOT reimplement or emit an empty commit.
- **Pre-existing uncommitted changes** in the tree unrelated to the plan → do not fold them into unit commits. Leave them or ask; a unit commit must contain only that unit.
- **Subagent edits outside the unit's files** → implementation subagents handed a plan path tend to "improve" the plan doc or touch neighbouring files. Put a hard scope rule in every brief ("edit ONLY these files; do not modify the plan or any other file; if something else seems to need changing, STOP and report it"), and before each commit `git status` to catch stray edits — `git checkout` them out before staging. A subagent rewriting the plan's design is a decision for the user, not a silent commit.
- **Plan changed mid-run** → if the user revises the plan while units are in flight, re-read the relevant unit section from the plan before dispatching it. Don't brief a unit from a stale parse.

## Relationship to other skills

- `ce-plan` produces the plan (units, U-IDs) this consumes.
- `ce-work` is a *skill* whose execution patterns (fresh-context subagents, test-as-you-go) this skill borrows by reading — not an agent it dispatches and not a loop it invokes. This skill drives its own per-unit loop and owns the commit boundary.
- `unit-review` consumes the output. The contract above is exactly its gate's input.

## Anti-goals

- Don't invoke `/ce-work` — it runs its own commit loop and breaks the one-commit-per-unit boundary. Drive the loop here; borrow its patterns by reading, not by dispatching.
- Don't squash at the end "to clean up" — that destroys the per-unit boundary the review depends on. The atomic commits ARE the deliverable.
- Don't enforce this on non-plan work; a typo fix doesn't need a unit contract.
