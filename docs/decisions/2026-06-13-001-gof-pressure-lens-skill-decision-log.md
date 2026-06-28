---
title: GoF Pressure Lens Skill Decision Log
slug: gof-pressure-lens-skill
type: decision-log
status: in-progress
date: "2026-06-13"
timezone: Australia/Melbourne
owner: skills/gof-pressure-lens
source:
  - docs/ideation/2026-06-13-gof-pressure-lens-skill-ideation.html
  - skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md
  - skills/skill-feedback/CONTEXT.md
  - "2026-06-13 Codex session: GoF pressure lens v1"
decision_metadata_format: fenced-yaml-per-decision
---

# GoF Pressure Lens Skill Decision Log

Use this log for accepted decisions about the `gof-pressure-lens` skill.

## Frame

- Build a thin skill for pressure-earned GoF naming.
- Keep ICA as the owner of architecture pressure and deepening judgment.
- Treat GoF names as translation after evidence, not discovery before evidence.
- Preserve `No pressure -> no pattern` as the v1 gate.
- Keep deterministic contracts out of prose until a runtime owner exists.

## Notes

- Use `grill-with-docs` plus `decision-mode` before implementation planning.
- Read `skills/create-skill/references/skill-design-decision-runbook.md` before authoring `SKILL.md`.
- Owner path settled as standalone `skills/gof-pressure-lens/`.
- V1 uses four routing labels: Artifact, Code Scan, Planning, and Pattern Referee.
- Defer ICA output envelope work to an ICA-owned CLI/runtime follow-up.

## Decision 1: Create V1 As Pressure Referee

```yaml
id: gof-pressure-lens-skill-001
status: accepted
decided_at: "2026-06-13"
decision: "Create v1 gof-pressure-lens as a pattern-referee skill with a pressure-source gate"
owner: skills/gof-pressure-lens
source:
  - docs/ideation/2026-06-13-gof-pressure-lens-skill-ideation.html
  - skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md
  - skills/skill-feedback/CONTEXT.md
  - "2026-06-13 Codex session: GoF pressure lens v1"
```

Decision:

- Create v1 of `gof-pressure-lens`.
- Make it a pattern referee, not an architecture reviewer.
- Name GoF patterns only after pressure exists.
- Validate the pressure source before naming patterns.
- Route existing-code requests through ICA first.
- Route planned-code requests through planned-ICA questions first.

Rationale:

- ICA owns seam pressure, Module, Interface, Depth, Locality, Leverage, Adapter placement, and deletion-test judgment.
- The GoF lens is useful after pressure exists because it gives stable names to already-earned shapes.
- A cold GoF scan would duplicate ICA and invite pattern cosplay.
- The skill-feedback v2 plan already shows the useful pattern: Facade and Adapter were earned from claim-safety pressure; fixed reducer flow stayed a locality label; Strategy stayed deferred until claim-rule variation is proven.

Consequences:

- `gof-pressure-lens` must stop when no pressure source exists.
- Existing code enters Code Scan Mode: run ICA first, then pass kept deepening candidates into the GoF lens.
- Existing artifacts enter Artifact Mode: consume the artifact and do not rerun ICA.
- Planned work enters Planning Mode: ask planned-ICA questions before naming a pattern hypothesis.
- Output should include kept, rejected, and deferred pattern names, plus seam owner, pressure proof, deletion-test consequence, and next safe action.

Next:

- Start a `grill-with-docs` + `decision-mode` session to settle v1 owner path, modes, input gate wording, output shape, and implementation sequence.
- After that decision pass, author the skill with `create-skill`.

V2 Ideas:

- Add a runtime validator only if prose gating fails or downstream agents need machine-readable pressure checks.
- Add a CLI helper only if repeated use needs structured output, fixtures, or regression tests.
- Add an ICA reference overlay if standalone skill discoverability creates duplicate-review behavior.

## Decision 2: Set V1 Shape And Defer ICA Envelope

```yaml
id: gof-pressure-lens-skill-002
status: accepted
decided_at: "2026-06-13"
decision: "Set v1 owner path, routing modes, pressure gate, output shape, and deferred ICA envelope"
owner: skills/gof-pressure-lens
decision_mode: standard
source:
  - docs/ideation/2026-06-13-gof-pressure-lens-skill-ideation.html
  - skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md
  - skills/improve-codebase-architecture/LANGUAGE.md
  - skills/create-skill/references/skill-design-decision-runbook.md
  - "2026-06-13 Codex session: GoF pressure lens v1 grill"
```

Decision:

- Implement v1 as a standalone repo skill at `skills/gof-pressure-lens/`.
- Keep the body thin and route pressure discovery back to ICA.
- Use Artifact, Code Scan, Planning, and Pattern Referee as v1 routing labels.
- Require pressure source, seam, Module / Interface pressure, deletion-test consequence, locality or leverage gain, and next safe action before naming GoF patterns.
- Return kept, rejected, and deferred pattern names, plus seam owner, pressure proof, deletion-test consequence, and next safe action.
- Use a prose gate in v1.
- Accept ICA reports, seam-swarm syntheses, plan pressure sections, prototype verdicts, and decision logs as pressure artifacts.
- Defer an ICA command-facade output envelope to a later ICA-owned CLI/runtime decision.
- Do not let GoF own an input envelope that duplicates ICA pressure semantics.

Rationale:

- Standalone skill routing improves discoverability for GoF naming requests.
- A hard ICA-routing gate limits duplicate architecture-review behavior.
- Four routing labels cover accepted use cases without creating four workflows.
- The six-field pressure gate makes `No pressure -> no pattern` executable in prose.
- The output shape forces agents to show why each pattern name survived.
- An ICA envelope is useful, but it changes CLI/runtime ownership and needs `create-cli` facade-backed proof.

Consequences:

- Cold existing-code requests route to ICA before GoF naming.
- Existing pressure artifacts can be consumed without rerunning ICA by default.
- Planned-work requests ask planned-ICA questions before pattern hypotheses.
- Drafted pattern sections can be kept, rejected, or deferred without scanning the whole codebase.
- Runtime validation waits for repeated prose-gate failure or a machine-readable consumer.

Next:

- Create `skills/gof-pressure-lens/SKILL.md` with `create-skill`.
- Verify frontmatter, owner paths, Markdown shape, and decision-log YAML.
- Revisit the ICA output envelope only after a concrete consumer needs machine-readable handoff.

V2 Ideas:

- Add an ICA-owned `ArchitecturePressureResult`-style envelope through `create-cli`.
- Add a runtime validator for the pressure gate if prose output drifts.
- Add an ICA reference overlay if standalone invocation causes duplicate-review behavior.
