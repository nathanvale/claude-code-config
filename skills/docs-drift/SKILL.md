---
name: docs-drift
description: "Check whether ADRs, CONTEXT.md, AGENTS.md, and docs/ still describe the code. Use for docs drift, doc audit, stale ADR, out-of-date AGENTS.md, or docs-code sync."
role: quality-gate
---

# Docs Drift

Resolve broken references mechanically, check each doc against the artifact that settles its claims, verify what survives, report by confidence. Report-only: this skill never edits docs.

**Drift** is a doc making a claim the code contradicts. The useful question is not *what kind* of drift it is — it is **what would you have to read to check this?**

| Tier | Source | Meaning |
|---|---|---|
| `deterministic` | Path resolved on disk, in-process | Objectively wrong |
| `judged` | Doc read against its named artifact, then verified | Needs human confirmation |
| `unverifiable` | Declared in the manifest | **Never scanned. Named in the report.** |

Superseded ADRs and historical plans are not drift — they correctly record history. The manifest freezes them.

## Run

1. Read `docs/agents/doc-targets.yml` from the repo under audit.
2. Author the workflow inline, passing the parsed manifest.

```js
const manifest = Bun.YAML.parse(await Bun.file(`${root}/docs/agents/doc-targets.yml`).text())
Workflow({ script: <the script>, args: { root, manifest } })
```

Nathan must have opted into orchestration — the ask itself counts.

- [references/manifest.md](references/manifest.md) — schema, worked example, how to build one
- [references/workflow.md](references/workflow.md) — the script and schemas

No manifest? Only the deterministic lens runs. Cheap and valid, but say so — it is not a full audit.

## Shape

`pipeline()`, not `parallel()`. Each doc verifies its own findings the moment its scan returns. One barrier at the end, where synthesis needs every doc at once to dedup.

```
reference ────────▶ resolve on disk (no agent) ──────────────┐
publishing.md ────▶ read release.yml ──────▶ verify ─────────┤
pull-requests ────▶ read 4 workflows ──────▶ verify ─────────┼──▶ synthesise
capability-tour ──▶ read catalog+payload ──▶ verify ─────────┤   (barrier)
installing.md ────▶ UNVERIFIABLE — not scanned ──────────────┘
```

Scanners run `haiku` at `low` effort. Verifiers inherit the session model.

**Naming the artifact is the whole point.** A scanner told to "find drift in the repo" will not open a 1000-line workflow file. On one real repo that gap left ~130 workflow claims across four docs entirely unread, while the run reported clean.

## Verify by committing first

Each verifier reads the doc and the artifact and forms **its own reading before the finding is revealed**, then compares. It defaults to refuted when uncertain.

This shape is deliberate. A judge that sees a claim and rates it scores plausibility rather than correctness; committing first drops false positives sharply where ground truth exists (arXiv 2607.05904). Scanners are also barred from verdict vocabulary — judges score confidently-worded findings 0.27-0.36 higher regardless of truth (arXiv 2606.09863), so `observation` fields state what the doc says and what the artifact does, and stop there.

**Three verdicts, not two.** `confirmed`, `refuted`, and `misfiled` — a real defect reported at the wrong location. A negative control planted two false claims: the verifier confirmed one, and refused the other while stating in its own words that a real defect existed at a different line than the scanner had blamed. A binary schema threw that away. `misfiled` keeps the defect and records where it actually is.

The scanner is also told plainly that **the doc is the fault site**. When a doc quotes an identifier the artifact does not have, the doc's wording is wrong — not the artifact. Blaming the artifact is what got that finding discarded.

## Report

Broken references first, judged findings second under an explicit caveat, then **what was not checkable and why**. Counts per doc, including zeros.

Nathan decides what to fix. Offer to route confirmed vocabulary gaps to `domain-modeling` and undocumented decisions to `record-decision`.

## Limits

**Judged findings are leads, not conclusions.** Best-in-class LLM judges reach ~0.65 AUROC on this class of verification, while mechanical detectors reach 0.83-0.95 (arXiv 2606.09863). That gap is why the reference lens never touches an agent. More verifiers do not close it — a three-judge ensemble still accepted 55% of wrong answers (arXiv 2607.05904). Treat the judged group as a worklist.

**Deterministic is not noise-free.** `test -e` is deterministic; deciding *which* backticked tokens are path claims is a heuristic. On a first run the raw heuristic gave 39 findings and 0 true positives — slash commands, npm specifiers, git refs, and sentences asserting a path's *absence* all read as broken paths. The shipped filters cut that to 1. Expect per-repo tuning.

**Silence is only meaningful for what was actually checked.** A doc of external-CLI claims returns zero findings whether accurate or wildly wrong. That is why `unverifiable` is a reported tier rather than an omission — usually the docs a repo cannot self-check are the ones that rot first.

**A quiet run is a real result.** One repo returned zero true positives from 39 candidates. Well-maintained docs do not drift much, and saying so beats padding a report with heuristic noise.

**Detection is the weaker half.** Preventing drift at merge time beats detecting it after — via spec-driven generation, or a test that derives the doc's claim from the artifact. That applies cleanly to generated artifacts and to enumerations (a test can assert a prose list matches a directory). It applies poorly to prose ADRs and hand-written runbooks, which is the surface this skill covers.

## Next safe action

No opt-in yet: describe the run and its rough agent count, then stop.
