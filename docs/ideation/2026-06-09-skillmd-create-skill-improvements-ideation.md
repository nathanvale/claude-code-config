---
date: 2026-06-09
topic: skillmd-create-skill-improvements
focus: "Improve create-skill as the SkillMD owner for authoring, reviewing, and healing skills"
mode: repo-grounded
---

# Ideation: SkillMD Create-Skill Improvements

## Grounding Context

- Subject: `skills/create-skill/` as the canonical SkillMD owner for skill authoring, review, healing, archive, consolidation, portability, and reusable guidance.
- Current first screen: `skills/create-skill/SKILL.md` routes by task family and names the owner files.
- Current core owner: `skills/create-skill/references/skill-design-decision-runbook.md`.
- Strong existing pattern: owner paths over copied contracts.
- Strong existing pattern: progressive disclosure through one-level `references/`.
- Strong existing pattern: evidence loop, gotcha decision, safety-gate escalation, direct repair path.
- Strong existing checks: owner paths, description collision/style, role/ability labels, gotcha-decision artifact format.
- Current audit evidence: `skill-description-audit.ts --json --check-style` found two quoted-description warnings and no collisions.
- Current audit evidence: `skill-role-audit.ts --json` passed.
- External source: Claude skill best practices emphasize concise `SKILL.md`, progressive disclosure, testing, workflows, and feedback loops.
- External source: Agent Skills overview frames skills as discovery, activation, execution with progressive disclosure.
- External source: Codex skills docs emphasize focused skills, clear steps, trigger testing, scope, and plugins for distribution.
- External source: community best-practice repos emphasize validation, edge-case testing, and lean context.

## Topic Axes

- Authoring pedagogy.
- Review and healing mechanics.
- Runtime-backed observability.
- Portfolio-level governance.
- User and agent ergonomics.

## Ranked Ideas

### 1. Add A SkillMD Doctor Command

**Description:** Build a single `create-skill` doctor command that runs the current audits and emits one structured report for a target skill. Include description audit, role audit, owner-path audit, gotcha-decision audit when given a review artifact, plus future UX checks.

**Axis:** Runtime-backed observability.

**Basis:** `direct:` current checks exist as separate scripts under `skills/create-skill/scripts/`; review work manually stitches their meaning together.

**Rationale:** The system already has useful checks, but the agent still has to know which one applies. A doctor command turns scattered checks into one visible health surface with repair hints.

**Downsides:** Requires a small runtime owner and probably `cli-author` involvement if exposed as a first-class CLI.

**Confidence:** 91%.

**Complexity:** Medium.

**Status:** Unexplored.

### 2. Add Skill Review Fixtures And Golden Cases

**Description:** Create a small fixture set of intentionally good and bad skills: prose-only skill, script-backed skill, unsafe side-effect skill, stale owner-path skill, bloated skill, and hidden-local-dependency skill. Use these to test review guidance and future doctor output.

**Axis:** Review and healing mechanics.

**Basis:** `direct:` `skill-design-decision-runbook.md` now defines a review checklist, but no fixture proves reviewers catch the expected failures.

**Rationale:** Fixtures convert taste into repeatable evidence. They also teach authors by showing what each failure looks like in a compact, inspectable example.

**Downsides:** Fixtures need maintenance when the rulebook changes.

**Confidence:** 88%.

**Complexity:** Medium.

**Status:** Unexplored.

### 3. Introduce A First-Minute Run Card Template

**Description:** Add a small reusable `Run Card` template reference for complex skills. Include plan, gather, inspect, verify, publish, fallback, visible state, and expected user progress messages.

**Axis:** User and agent ergonomics.

**Basis:** `direct:` `skill-design-decision-runbook.md` now names `Run Card Pattern`, but there is no worked example for authors to copy or reviewers to compare against.

**Rationale:** Long skills fail when the first minute is unclear. A template gives authors a concrete way to make activation useful without inflating every `SKILL.md`.

**Downsides:** Can become boilerplate if applied to tiny skills.

**Confidence:** 86%.

**Complexity:** Low.

**Status:** Unexplored.

### 4. Add A Skill Healing Triage Map

**Description:** Add a reference that maps failure symptoms to repair lanes: routing miss, bloated first screen, copied contract, missing owner, stale command, unsafe side effect, hidden dependency, portability leak, weak verification, and bad final output.

**Axis:** Review and healing mechanics.

**Basis:** `direct:` create-skill owns create, review, heal, repair, archive, and merge, but the runbook currently organizes by design concepts rather than symptom-first repair.

**Rationale:** Healing starts from a symptom. A triage map helps agents avoid broad rewrites and jump to the smallest owner-path patch.

**Downsides:** Overlap risk with the existing review checklist; keep it symptom-first and short.

**Confidence:** 84%.

**Complexity:** Low.

**Status:** Unexplored.

### 5. Make “Skill Quality Bar” Concrete Per Task Family

**Description:** Add compact quality-bar cards for common task families: write-something, run-command, tool-workflow, control-plane, quality-gate, support-reference, and runtime-backed capability.

**Axis:** Authoring pedagogy.

**Basis:** `direct:` the evidence loop requires comparing against the task-family skill quality bar, but most task-family bars are implicit across several references.

**Rationale:** Authors and reviewers need to know what “good enough” means for the specific kind of skill they are handling. Cards reduce subjective review drift.

**Downsides:** Could duplicate `skill-roles.md` and `skill-io-shape-examples.md` unless written as pointers plus checks.

**Confidence:** 82%.

**Complexity:** Medium.

**Status:** Unexplored.

### 6. Add Portfolio Health Reporting

**Description:** Add a report command that summarizes all active skills by role, description style, missing owner paths, local-only portability risks, stale bridges, runtime-backed skills without verification, and skills without clear next safe action.

**Axis:** Portfolio-level governance.

**Basis:** `direct:` there are 38 active skills in the current audit, and existing scripts can already inspect several portfolio dimensions.

**Rationale:** SkillMD is not only one-skill authoring; it also owns the health of a growing skill portfolio. A portfolio report exposes drift before it becomes cleanup archaeology.

**Downsides:** Needs careful scope so it does not become a broad governance dashboard.

**Confidence:** 80%.

**Complexity:** Medium.

**Status:** Unexplored.

### 7. Add A Review-To-Patch Handoff Shape

**Description:** Define a standard review output shape that maps each finding to owner path, evidence class, smallest repair, check to run, and whether it is a reusable-rule proposal or direct repair.

**Axis:** Review and healing mechanics.

**Basis:** `direct:` the runbook distinguishes evidence-loop reusable-rule changes from direct repairs, but review findings today can still land as prose without a patch path.

**Rationale:** This closes the loop from “found issue” to “repairable action.” It also prevents accidental reusable-rule edits when the finding only needs a direct metadata or owner-path repair.

**Downsides:** Adds structure to reviews; keep it optional unless review is intended to feed healing.

**Confidence:** 79%.

**Complexity:** Low.

**Status:** Unexplored.

## Rejection Summary

| # | Idea | Reason Rejected |
|---|---|---|
| 1 | Rewrite create-skill as one large canonical handbook | Violates progressive disclosure and existing owner-path decisions. |
| 2 | Add a mandatory checklist to every skill body | Bloats skills and turns review guidance into repeated prose. |
| 3 | Auto-heal skills whenever audits fail | Unsafe authority jump; accepted reusable rules still need user approval. |
| 4 | Add scoring grades to every skill | Too governance-heavy without a clear repair path. |
| 5 | Replace references with generated docs | Unsupported by current owners; generated outputs should name source and not become authoring source. |
| 6 | Create a new standalone SkillMD skill separate from create-skill | Duplicates the chosen canonical owner. |
| 7 | Add more banned words to startup instructions | Wrong owner surface; skill authoring rules belong in create-skill. |

## Suggested Next Step

- Brainstorm idea 1 and idea 2 together as one slice: `SkillMD doctor plus fixtures`.
- Keep idea 3 as a quick standalone doc improvement if runtime work is too much.
- Treat idea 6 as a later follow-up after the doctor command proves useful.

## Sources

- Local owner: `skills/create-skill/SKILL.md`.
- Local owner: `skills/create-skill/CONTEXT.md`.
- Local owner: `skills/create-skill/references/skill-design-decision-runbook.md`.
- Local owner: `skills/create-skill/references/skill-io-shape-examples.md`.
- Local owner: `skills/create-skill/references/runtime-portability.md`.
- Local owner: `skills/create-skill/references/skill-roles.md`.
- Local owner: `skills/create-skill/references/skill-dependency-rules.md`.
- Local owner: `skills/create-skill/scripts/`.
- Decision log: `docs/decisions/2026-06-06-001-decisions-skill-decision-log.md`.
- Claude skill best practices: `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`.
- Agent Skills overview: `https://agentskills.io/home`.
- Codex skills docs: `https://developers.openai.com/codex/skills`.
- Community guide: `https://github.com/mgechev/skills-best-practices`.
