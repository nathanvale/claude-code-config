---
name: unit-review
description: "Triggers on 'unit review', 'review each unit', 'per-unit review', 'review this branch by unit'. Fans out persona-matched reviewers per implementation unit, verifies each finding, then consolidates one report. Gated: falls back to whole-diff review when the branch isn't unit-structured."
---

# Unit Review

Review a branch by scoping one reviewer per implementation unit, matched to that unit's risk surface, with a verify pass and a cross-seam reviewer, aggregated into a single findings report.

Use only when the win is real: a multi-unit feature on a branch with clean per-unit commits. Otherwise fall back to plain review — this skill self-checks and routes.

## Stop conditions (fail closed)

- Diff < 50 changed lines OR ≤ 2 files → do NOT fan out. Run a single plain review and say so.
- Not unit-structured (see Gate) → do NOT fan out. Fall back to `/ce-code-review` (its multi-persona model is the right tool for a substantial whole-diff branch; `/review` for a tiny diff) and say why. This skill is ADDITIVE over `ce-code-review` — it adds per-unit scoping, the cross-seam pass, and the verify pass; it does not replace it.
- Read-only. This skill reviews; it never edits source. Findings are claims until the verify pass confirms them.

## Gate — is this branch unit-structured?

Detect units, don't assume them. Unit-structured requires BOTH:

1. A plan exists with Implementation Units — `docs/plans/*.md` (or `.html`) containing a `## Implementation Units` / `U-ID` section.
2. Commits since the base map ~1:1 to those units — a U-ID in commit subjects (`(U3)`, `U3:`), OR commit count since base ≈ unit count with coherent per-commit file clusters.

If only one holds, treat as NOT unit-structured. Don't invent unit boundaries from a flat diff — that's where this skill degrades into noise.

## Flow

1. **Resolve base + range.** Default base = merge-base with the repo default branch. Range = `base..HEAD`. List commits and their files.
2. **Gate** (above). If it fails a stop condition, fall back and stop here.
3. **Map units → (commit, files, risk surface).** One row per unit. Risk surface drives persona choice.
4. **Derive a lens per unit** from the plan unit (Goal, Files, Approach, KTDs, Risks) + the commit diff — what to scrutinise here and why. Do not hand-wait for a human to write lenses; generate them. See `references/lenses.md`.
5. **Build the do-not-flag list** from the plan's confirmed decisions / convergence log / accepted risks, so reviewers don't re-litigate settled choices. A short, sharp do-not-flag list is what keeps signal high.
6. **Fan out reviewers in parallel** — one per unit, persona matched to risk surface (table below). Read-only. Each returns findings in the fixed format.
7. **Cross-seam reviewer** — one extra reviewer sees the WHOLE diff to catch bugs living *between* units (a type that drifts across the U4→U5→U6 seam). Per-unit scoping cannot catch these.
8. **Verify pass** — for each blocker/major, dispatch a refuter that tries to prove the finding WRONG against the code. This is the precision gate; skipping it ships hallucinated lines. The refuter contract (input bundle, `{ validated, reason }` output, and the conservative-on-failure rule — a refuter that errors/times out DROPS the finding, never passes it through) is in `references/verify-pass.md`. Honor it.
9. **Consolidate** — one report: verdict roll-up table, findings by severity (verified only, with cross-unit themes merged), confirmed-clean list, recommended fix order (smallest blast radius first). See `references/report-template.md`.

## Persona → risk surface

| Unit touches | Reviewer persona |
| --- | --- |
| parsing, pure logic, data transforms | correctness |
| auth, input handling, money, file I/O, export | security |
| commit/mutation, retries, batch, external API | adversarial (construct failure scenarios) |
| async UI, lifecycle, DOM timing | frontend-races |
| tests only | testing (does it falsify, or rubber-stamp?) |
| docs, specs, mappings | coherence (internal contradictions) |
| migrations, schema | data-integrity |

Match the heaviest risk the unit touches. Compose more than one persona for a unit that spans surfaces (e.g. a commit unit that's both adversarial + security).

## Finding format (every reviewer)

`[SEV: blocker|major|minor|nit] <file>:<line> — <what> — <why> — <recommended action>`

Severity reflects confidence. Prefer fewer high-confidence findings. `CLEAN — <one-line confidence>` if nothing. End each reviewer with `VERDICT: ship | ship-with-nits | fix-before-merge`.

## Cost note

Fan-out spends real tokens (≈40-80k per reviewer). Justified for a multi-unit feature; wasteful on small changes — which is why the stop conditions gate it. Say the rough reviewer count before fanning out so the user can veto.

## Output

Write the consolidated report to the OS temp dir (or `docs/reviews/` only if the user asks). Never commit it. The skill produces findings, not fixes — hand the report to a remediation flow (`/ce-resolve-pr-feedback`-style) if the user wants changes applied.

## References (load on demand)

- `references/verify-pass.md` — refuter contract for step 8. Load before the verify pass.
- `references/lenses.md` — lens-derivation worked examples. Load only if step 4 needs them (the persona table above is canonical; lenses.md links to it, never restates it).
- `references/report-template.md` — full consolidated-report shape. Load at step 9 if the inline summary isn't enough.
