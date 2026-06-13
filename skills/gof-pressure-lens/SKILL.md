---
name: gof-pressure-lens
description: "GoF pattern naming, pattern referee, and pressure-earned design-pattern labels after ICA, plan, prototype, or decision evidence."
role: advisor
---

# GoF Pressure Lens

Use when the user asks whether GoF pattern names are earned by existing
architecture pressure.

## Boundary

- Act as a pattern referee, not an architecture reviewer.
- Treat GoF names as translation after evidence, not discovery before evidence.
- Keep ICA as the owner of architecture pressure and deepening judgment.
- Preserve `No pressure -> no pattern`.
- Do not run a cold GoF scan.
- Do not teach the GoF catalog unless needed to explain a verdict.

## Owner Map

- Skill decision log: `docs/decisions/2026-06-13-001-gof-pressure-lens-skill-decision-log.md`.
- ICA workflow owner: `skills/improve-codebase-architecture/SKILL.md`.
- ICA vocabulary owner: `skills/improve-codebase-architecture/LANGUAGE.md`.
- Skill authoring owner: `skills/create-skill/references/skill-design-decision-runbook.md`.
- Deferred ICA output envelope: no owner path exists yet; use `skills/create-cli/SKILL.md` before adding one.

## Pick One

- Artifact Mode: consume an existing pressure artifact.
- Code Scan Mode: route existing code through ICA first.
- Planning Mode: ask planned-ICA questions before naming pattern hypotheses.
- Pattern Referee Mode: judge already-written pattern claims.

## Pressure Gate

Before naming a pattern, collect:

- Pressure source.
- Seam.
- Module / Interface pressure.
- Deletion-test consequence.
- Locality or leverage gain.
- Next safe action.

If any field is absent, stop pattern naming and route:

- Existing code: run ICA first.
- Planned code: ask planned-ICA questions first.
- Existing artifact: ask for the missing field or mark the pattern deferred.
- Drafted pattern section: reject claims that lack pressure proof.

## Artifact Mode

Accepted pressure artifacts:

- ICA report.
- Seam-swarm synthesis.
- Plan pressure section.
- Prototype verdict.
- Decision log.

Consume the artifact by default. Do not rerun ICA unless the artifact is stale,
contradictory, or missing the pressure gate.

## Code Scan Mode

- Run ICA before GoF naming.
- Pass only kept ICA candidates into this lens.
- Reject pattern names attached to dropped or speculative ICA candidates.
- Stop with `No pressure -> no pattern` when the user asks for GoF names without pressure evidence.

## Planning Mode

Ask planned-ICA questions before naming a pattern hypothesis:

- What seam will change?
- What caller complexity concentrates behind the Interface?
- What deletion-test consequence would prove the Module earns its keep?
- What locality or leverage improves?
- What second adapter, variation point, or future caller would make the seam real?

Name patterns as hypotheses until implementation or artifact evidence exists.

## Pattern Referee Mode

For each candidate pattern name:

- Keep when pressure exists, the seam owner is named, and the deletion test passes.
- Reject when pressure is absent, the seam is vague, ICA vocabulary is enough, or the name adds decorative abstraction.
- Defer when pressure exists but a second adapter, second use case, or implementation proof has not arrived.

Use non-GoF locality labels when the GoF catalog would misname the pressure.

## Output Shape

Return:

- Kept pattern names.
- Rejected pattern names.
- Deferred pattern names.
- Seam owner.
- Pressure proof.
- Deletion-test consequence.
- Next safe action.

## V2

- Add a runtime validator only after repeated prose-gate failure or machine-readable output need.
- Add an ICA facade-backed output envelope only through ICA and `create-cli`.
- Add an ICA reference overlay only if standalone discoverability creates duplicate-review behavior.

## Next Safe Action

- If pressure exists, name kept, rejected, and deferred patterns.
- If pressure is missing, route to ICA, planned-ICA questions, or a pressure-artifact request.
