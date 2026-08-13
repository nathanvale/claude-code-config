---
name: docs-drift
description: "Check whether ADRs, CONTEXT.md, AGENTS.md, and docs/ still describe the code. Use for docs drift, doc audit, stale ADR, out-of-date AGENTS.md, or docs-code sync."
role: quality-gate
---

# Docs Drift

Fan scanners across the repo, verify every claimed finding adversarially, report what actually drifted. Report-only: this skill never edits docs.

**Drift** is a doc making a claim the code contradicts. Four lenses find four kinds; each needs different evidence, and only two are objective.

| Lens | Claim shape | Evidence | Verifiable |
|---|---|---|---|
| `reference` | A named path, script, command, or flag exists | Resolve it on disk | Objective |
| `claim` | Behaviour works as described | Read both sides | Judgement |
| `vocabulary` | Domain terms match the glossary | Term appears in code but not `CONTEXT.md`, or vice versa | Judgement |
| `decision` | Load-bearing choices are recorded | Hard-to-reverse choice with no ADR | Weakest |

Superseded ADRs are not drift. An ADR marked superseded is correctly stale — it records history. Only an ADR presenting itself as current can drift.

## Run

Author the workflow inline; pass the repo's doc surface as `args`. Nathan must have opted into orchestration — the ask itself counts.

```
Workflow({ script: <the script below>, args: { root: "<repo>" } })
```

Read [references/workflow.md](references/workflow.md) for the script and the schemas.

## Shape

`pipeline()`, not `parallel()`. Each lens verifies its own findings the moment that lens returns, rather than waiting for the slowest scanner. One barrier at the end, where synthesis genuinely needs every lens at once to dedup.

```
lens ──▶ scan (haiku, low) ──▶ verify each finding (inherit) ─┐
lens ──▶ scan ──────────────▶ verify ────────────────────────┼──▶ synthesise
lens ──▶ scan ──────────────▶ verify ────────────────────────┘   (barrier)
```

Scanners run `haiku` at `low` effort — resolving whether a path exists is mechanical. Verifiers inherit the session model: refuting a claimed drift is where a wrong call costs the most, so it gets the strongest model available.

## Verify adversarially

Each verifier tries to **refute** its finding, and defaults to refuted when uncertain. A doc that reads oddly but states nothing false is not drift. Findings that survive carry `file:line` on both sides — the doc making the claim and the code contradicting it.

Without this pass the report fills with prose the scanner found merely surprising.

## Report

Group by lens, most objective first: broken references, then contradicted claims, then vocabulary, then undocumented decisions. Each finding names the doc, the code, and the one-line contradiction. State the counts per lens, including zeros — a lens that found nothing is a result.

Nathan decides what to fix. Offer to route confirmed vocabulary gaps to `domain-modeling` and undocumented decisions to `record-decision`.

## Next safe action

No opt-in yet: describe the run and its rough agent count, then stop.
