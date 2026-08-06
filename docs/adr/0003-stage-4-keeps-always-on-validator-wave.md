---
status: accepted
date: 2026-05-24
---

# Stage 4 Keeps the Always-On Validator Wave (No Reduced-Wave Gate)

Issue-to-PR Stage 4 dispatches the full always-on Validator set (`ce-correctness-reviewer`, `ce-testing-reviewer`, `ce-maintainability-reviewer`, `ce-project-standards-reviewer`, `ce-adversarial-reviewer`) on every committed implementation attempt (Builder envelope or Orchestrator-inline), plus any conditional personas the selector fires. Issue #69 asked whether Stage 4 should gain a bounded reduced-wave path for trivially-scoped batches, mirroring the Stage 5 mechanical-diff fallback. The decision is **no**: keep the always-on wave unchanged and add no reduced-wave gate. The inline path does not get a reduced wave; the always-on floor is path-independent.

## Context

The Stage 5 mechanical-diff fallback lets the Orchestrator substitute a single `ce-correctness-reviewer` for the full `/ce-code-review` wave when more than 80% of the cumulative diff is mechanical. Issue #69 proposed mirroring that at Stage 4 behind a conservative gate (for example: `execution_mode: change_first` AND docs-only `batch.files` AND a small line threshold AND no conditional persona signals).

The decision rests on three points, two of them verified against the runbook source:

1. **The precedent does not transfer (category error).** The Stage 5 fallback is safe specifically because it is a redundant *second* pass. Its own justification names the property: it avoids "re-litigating already-closed surfaces" (`runbooks/issue-to-pr-v2/references/findings-and-validators.md`, Mechanical-diff fallback), and it MUST receive every ledger-recorded finding signature so it can dedupe and surface only NEW findings. Stage 4 is the *first and only* deep review of each batch's code. It has no already-closed surfaces to re-litigate and no prior finding signatures to dedupe against (Stage 4 is where findings are first created). A reduced wave there thins the primary safety net, not a redundant second one.

2. **The always-on five are a deliberate, protected floor.** The persona selector already provides graduated cost: every specialist and language reviewer (`ce-security-reviewer`, `ce-data-migrations-reviewer`, `ce-api-contract-reviewer`, `ce-performance-reviewer`, `ce-reliability-reviewer`, `ce-swift-ios-reviewer`, `ce-julik-frontend-races-reviewer`, Rails/Python/TypeScript reviewers, `ce-previous-comments-reviewer`) is gated behind a path, contract, or focus signal. The always-on five are precisely the language- and domain-agnostic reviewers that apply to any change. The runbook already treats this set as a hard minimum: when fewer than the always-on personas can run, the Validator invocation rules trigger fail-stop behavior (`findings-and-validators.md`, Validator invocation rules). A reduced-wave gate would mean the Orchestrator voluntarily dropping below a floor the system otherwise fail-stops to protect.

3. **The savings are smallest exactly where mis-gating hurts most (this repo).** A "docs-only" gate fires most reliably on `.md` changes. In this repo, `.md` files carry runbook contracts, the regression matrix, and `## Findings data` tables that `decompose.ts` parses. The proposed conjunction (change_first + small diff + no conditional signals) narrows how *often* the gate fires but not its *blast radius*: a contract-bearing doc throws no conditional persona signals and can be a small diff, so the gate would fire hardest on the highest-stakes-yet-innocent-looking changes. The cost of a false negative (a thin review on a contract change) dominates the cost saved (a few skipped persona calls on genuinely trivial batches).

## Decision

Keep the Stage 4 always-on Validator wave as-is. Do not add a reduced-wave gate. The full always-on set runs on every committed implementation attempt (Builder envelope or Orchestrator-inline); conditional personas continue to layer on top via the selector. The wave is identical on both paths: Orchestrator-inline `change_first` attempts do not earn a reduced wave by virtue of being inline.

## Consequences

- Stage 4 review behavior is unchanged; the always-on five remain a non-negotiable floor per committed implementation attempt, regardless of whether the attempt was a Builder envelope or an Orchestrator-inline `change_first` attempt.
- The cost of the full wave on trivially-scoped batches is accepted as cheap insurance, consistent with issue #69's own note that the cost on a smoke test is negligible.
- The mechanical-diff fallback stays Stage 5 only, where its "already-closed surfaces" safety property holds.

## Re-evaluation

If Stage 4 validator cost ever becomes a real pain on large multi-batch runs (the cost compounds per committed implementation attempt: batches x repair attempts x personas, across Builder envelopes and Orchestrator-inline attempts alike), prefer the cheaper levers before reconsidering a gate:

- **Batch granularity.** Avoid decomposing trivial work into its own batch; fold it into an adjacent batch so it shares one wave.
- **Extend the existing Stage 5 fallback** rather than inventing a Stage 4 one, since the Stage 5 mechanism already has the dedupe and already-reviewed safety properties a Stage 4 gate lacks.

Revisit only if a future change gives Stage 4 an equivalent "already-reviewed" backstop, or if measured cost on real runs outweighs the mis-gating risk documented above.
