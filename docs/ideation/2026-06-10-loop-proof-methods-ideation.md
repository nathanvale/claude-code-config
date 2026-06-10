---
date: 2026-06-10
topic: loop-proof-methods
title: Loop-proof method catalog — ideation
type: ideation
owner: skills/skill-self-audit-loop/references/loop-proof-methods.md
---

# Loop-Proof Method Catalog — Ideation

## Frame

Map loop anatomy -> characteristic failure -> matching proof method, so a catalog of "how to prove a loop-engineering feature works" covers every loop part.

Each method must carry a trust condition (`oracle` | `independence` | `adversarial` | `falsifiability`). A method without one is theater.

Five ideation agents ran in parallel: stop-rule methods, state-ledger methods, repair-handoff methods, anatomy-completeness check, cross-domain analogy mining.

Owner of the survivors: `skills/skill-self-audit-loop/references/loop-proof-methods.md`.

## Anatomy (after completeness pass)

Nine parts. Three rejected candidates folded into trust conditions rather than parts, to stop the catalog fragmenting.

- Trigger / input — unearned.
- Step function — earned (fixture pair).
- Model-judgment — earned (blind-judge replication).
- Stop rule — earned (idempotent convergence).
- State ledger — earned (resume-honesty replication).
- Idempotency / resume-safety — unearned.
- Nesting / orchestration — N/A (single-level loop).
- Repair handoff — earned (blind downstream actionability).
- Design decision — earned, out-of-loop (adversarial premise attack).

Folded as trust conditions, not parts:

- Routing -> step function (multi-class fixture).
- Cost / budget -> stop rule (halt must name its reason).
- Observability -> state ledger (fresh agent reconstructs the run).
- Harness-vs-prompt -> cross-cutting precondition (provable only if harness-owned).

## Survivors (earned this session)

Six methods ran against real artifacts and passed, earning their slots.

- Fixture pair (step function). Oracle. `fixture-positive-safety` accepted 3/3; `fixture-negative-near-miss` rejected 3/3.
- Blind-judge replication (model-judgment). Independence. 6 agents, 6/6 unanimous, 0 flips.
- Idempotent convergence / MR-4 (stop rule). Falsifiability. Fresh blind pass on the converged self-audit reproduced zero new accepted.
- Resume-honesty replication (state ledger). Independence + oracle. Blind agent resumed the create-cli loop file, re-derived 3 closed signatures as non-contradictions, re-opened none.
- Blind downstream actionability (repair handoff). Independence + oracle. Blind create-skill agent acted on RC-1, quoted both sources, proposed a valid fix, did not need the narrative.
- Adversarial premise attack (design decision). Adversarial. 4 reviewers killed the proposed multi-skill sweep before build.

## Strongest cross-cutting insight

An LLM prose judge often has no per-output oracle. Metamorphic relations — assert the output relation under an input transform — beat oracles there. MR-4 (idempotent convergence) fills the stop-rule gap without ground truth. This is the highest-leverage proof shape for model-driven loops.

## Candidate methods generated, not yet earned

Kept as named slots or companions in the catalog; not run this session.

- Trigger corpus (trigger/input): labeled should-fire / should-not-fire inputs, incl. an under-trigger case.
- Mutation kill-rate (step function scale-up): N single-fault mutants, one per shape, plus equivalent mutants; report kill-rate + false-kill-rate.
- Pre-registered predicate (stop rule companion): fix the convergence predicate before the run; assert the halt matched it, not a cost cap.
- False-convergence injection (stop rule companion): inject a known finding into a converged target; loop must flip back to active.
- Frontmatter-body consistency oracle (state ledger companion): static invariants between frontmatter and body.
- Golden-ledger drift (state ledger companion): freeze the ledger; diff after a rule or model change.
- Replay-twice equivalence (idempotency): run pass N twice from the same input; assert identical ledger, incl. a partial write.
- Isolation probe (nesting): two inner invocations sharing a poisonable key; prove the sibling sees clean state.
- Over-reach tripwire (repair handoff companion): watch the working tree; assert only the audit file mutates.

## Rejected, with reasons

- SPC convergence control chart (K=10+ repeated runs). Real but expensive; the cheap substitute is MR-4 plus 3x replication. Reject for v1; note as scale-up.
- Canary findings. Folds into the fixture pair — a maximally-blatant positive is not a distinct method.
- Most drop-one / reconstruction handoff variants (PM-4, PM-6, PM-7). Diminishing returns over blind actionability; keep one, defer the rest.
- Routing / cost / observability / harness as separate parts. Correctly folded into trust conditions; separate slots would fragment the catalog.

## Free findings surfaced while mining

- create-cli loop file had ledger-shape drift: a stray `- None.` inside `## Finding History`. Fixed this session.
- The two fixtures leak their verdict in frontmatter `name`/`description`. Acceptable for labeled fixtures; weakens true blinding. Recorded as a known limitation in the catalog's blind-judge entry. Not renamed — the directory name derives the loop-file path.

## Outcome

Catalog written to `skills/skill-self-audit-loop/references/loop-proof-methods.md` with 6 earned methods and worked examples, 3 named-unearned slots, and the growth gate (a method earns a slot only after it has proven or broken a real loop change).

## Sources

- `docs/research/loop-engineering-patterns/` — loop anatomy patterns.
- `docs/brainstorms/2026-06-10-skill-self-audit-loop-v2-requirements.md` — the v2 test-harness reframe that produced the first earned methods.
- `skills/skill-self-audit-loop/SKILL.md` — the loop under test.
