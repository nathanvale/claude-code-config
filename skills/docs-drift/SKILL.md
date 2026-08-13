---
name: docs-drift
description: "Check whether ADRs, CONTEXT.md, AGENTS.md, and docs/ still describe the code. Use for docs drift, doc audit, stale ADR, out-of-date AGENTS.md, or docs-code sync."
role: quality-gate
---

# Docs Drift

Resolve broken references mechanically, fan scanners across the rest, verify what remains, report by confidence. Report-only: this skill never edits docs.

**Drift** is a doc making a claim the code contradicts. Four lenses find four kinds, and they do not carry equal weight.

| Lens | Claim shape | How it is checked | Confidence |
|---|---|---|---|
| `reference` | A named path or script exists | Resolved on disk, in-process | **Deterministic** |
| `claim` | Behaviour works as described | LLM verifier | Judged |
| `vocabulary` | Domain terms match the glossary | LLM verifier | Judged |
| `decision` | Load-bearing choices are recorded | LLM verifier | Judged |

**Deterministic is not the same as noise-free.** `test -e` is deterministic; deciding *which* backticked tokens are path claims is a heuristic, and that is where the false positives live. On a first run against a real repo the raw heuristic produced 39 findings and 0 true positives — slash commands, npm specifiers, git refs, superseded ADRs, and sentences asserting a path's *absence* all read as broken paths. The shipped filters cut that to 1. Expect to tune `excludeDirs` per repo.

Superseded ADRs are not drift. An ADR marked superseded is correctly stale — it records history. Only an ADR presenting itself as current can drift.

## Run

Author the workflow inline; pass the repo's doc surface as `args`. Nathan must have opted into orchestration — the ask itself counts.

```
Workflow({ script: <the script>, args: { root: "<repo>" } })
```

Read [references/workflow.md](references/workflow.md) for the script, the schemas, and the `resolveReferences()` contract.

## Shape

`pipeline()`, not `parallel()`. Each judged lens verifies its own findings the moment that lens returns. One barrier at the end, where synthesis genuinely needs every lens at once to dedup.

```
reference ─▶ resolve on disk (no agent) ──────────────────────┐
claim ────▶ scan (haiku, low) ──▶ verify each (inherit) ──────┤
vocabulary ▶ scan ──────────────▶ verify ─────────────────────┼──▶ synthesise
decision ─▶ scan ───────────────▶ verify ─────────────────────┘   (barrier)
```

Scanners run `haiku` at `low` effort — finding candidates is mechanical. Verifiers inherit the session model. A clean repo costs 3 agents.

## Verify by committing first

Each verifier reads the doc and the code and forms **its own reading before the finding is revealed**, then compares. It defaults to refuted when uncertain.

This shape is deliberate. A judge that sees a claim and rates it scores plausibility rather than correctness; committing first drops false positives sharply where ground truth exists (arXiv 2607.05904). Scanners are also barred from verdict vocabulary — judges score confidently-worded findings 0.27-0.36 higher regardless of whether they are true (arXiv 2606.09863), so `observation` fields state what the doc says and what the code does, and stop there.

## Report

Deterministic findings first, judged findings second under an explicit caveat. Each finding names the doc, the code, and the observation. State the counts per lens, including zeros — a lens that found nothing is a result.

Nathan decides what to fix. Offer to route confirmed vocabulary gaps to `domain-modeling` and undocumented decisions to `record-decision`.

## Limits

Two, and both are worth stating rather than hiding:

**Judged findings are leads, not conclusions.** Best-in-class LLM judges reach ~0.65 AUROC on this class of verification, while mechanical detectors reach 0.83-0.95 (arXiv 2606.09863). That gap is why `reference` never touches an agent. More verifiers do not close it — a three-judge ensemble still accepted 55% of wrong answers (arXiv 2607.05904). Treat the judged group as a human's worklist.

**A quiet run is a real result.** The first repo this ran against returned zero true positives from 39 candidates. Well-maintained docs do not drift much, and a report saying so is worth more than one padded with heuristic noise.

**Detection is the weaker half of the problem.** The industry consensus is that preventing drift at merge time beats detecting it afterwards, via spec-driven generation or a docs check in the PR. That applies cleanly to generated artifacts — OpenAPI specs, typed signatures. It applies poorly to prose ADRs and a hand-written glossary, which is the surface this skill covers. Use it as an audit, and keep generated docs generated.

## Next safe action

No opt-in yet: describe the run and its rough agent count, then stop.
