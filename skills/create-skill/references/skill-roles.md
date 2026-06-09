# Skill Roles

Use when creating, auditing, archiving, or consolidating skills.

## Preview Index

- Read `Rule`, `Role Label`, and `Ability Labels` before changing frontmatter.
- Read `Role Card Shape` before adding a new role card.
- Read only the role card that matches the skill's first-screen job.
- Read `Checks` before handoff.
- Read `Provenance Rule` only when tracing why this role system exists.

## Rule

- Give every active skill one primary role.
- Add optional abilities when a skill has small extra powers.
- Pick the role from what the skill does on its first screen.
- Keep role labels boring.
- Do not create a new role when an existing role fits.
- Do not use abilities as a second role.
- Add a role only to clarify routing, ownership, archive safety, or dependency rules.

## Role Label

Store the role in `SKILL.md` frontmatter.

```yaml
role: main-entry | advisor | tool-workflow | support-reference | control-plane | quality-gate | bridge
```

## Ability Labels

Store optional abilities in `SKILL.md` frontmatter.

```yaml
abilities:
  - accepted-doc-capture
  - temp-report-generation
```

Allowed abilities:

- `accepted-doc-capture`: may write accepted glossary, context, ADR, decision, or tracker notes as capture after the user accepts.
- `temp-report-generation`: may create temporary report artifacts outside the repo unless the user asks to keep them.

Ability rules:

- Use abilities only for behavior outside the primary role card.
- Keep abilities small.
- Name write authority when the ability writes files.
- Split the skill if an ability becomes the main workflow.

## Role Card Shape

Each role card must be executable by an agent.

Use this shape:

- Archetype: memorable execution image.
- Job: what this role exists to do.
- First move: what to do before anything else.
- Inputs: what the role needs.
- Must output: what the role must return or change.
- Stop when: where the role ends.
- Missing dependency behavior: blocked or degraded.

## Main Entry

Use for a skill that is the main entry point for a broad work area.

Archetype: main entrance.

Job: route broad work to the right owner path, reference, script, or next safe action.

First move: classify the request shape.

Inputs: user request, current repo context, owner paths, bundled references.

Must output: selected route, owner paths, needed references, and next safe action.

Stop when: the request is routed or a required owner is missing.

Missing dependency behavior: blocked when the missing owner makes routing unsafe; degraded only for optional references.

Runbook:

- Route the request shape.
- Name the owner paths.
- Point to bundled references.
- Hand off only through labeled dependencies.
- Give the next safe action.

Examples:

- `create-skill`
- `create-cli`

## Advisor

Use for a skill that recommends, classifies, or sharpens a choice without owning the final write.

Archetype: map reader.

Job: recommend where something belongs or which choice fits the current language.

First move: read the relevant glossary, map, or accepted decisions.

Inputs: unclear choice, glossary/map, safety constraints, nearby rejected options.

Must output: recommendation, assumptions, rejected nearby choices, and next safe action.

Stop when: the user accepts, the answer is clear, or the choice needs decision logging.

Missing dependency behavior: blocked when the map/glossary is missing and the answer would be a guess.

Runbook:

- Read the relevant glossary or map.
- Return the recommendation.
- Name assumptions.
- Name rejected nearby choices.
- Escalate to decision logging only after acceptance.

Examples:

- `context-advisor`
- `decision-mode`

## Tool Workflow

Use for a skill that operates one tool, service, CLI, API, or user workflow.

Archetype: operator.

Job: run a concrete workflow safely through its owning tool or command.

First move: check required setup and owner command.

Inputs: user request, config, tool availability, command owner path, safety gates.

Must output: result, evidence, blocked state, or degraded state.

Stop when: the workflow succeeds, blocks, or reaches the next human decision.

Missing dependency behavior: blocked for required config/tool/data; degraded only for non-essential enrichment.

Runbook:

- Check required setup.
- Run the owner command or connector.
- Parse the result.
- Report success, blocked state, or degraded state.
- Keep command details in code/help when possible.

Examples:

- `productivity-sync`
- `browser-use`
- `imessage-reader`
- `summarize`

## Support Reference

Use for a non-user-facing skill that exists to support another skill.

Archetype: parts drawer.

Job: provide maps, connector lists, examples, or support rules for a parent skill.

First move: identify the parent skill and requested support surface.

Inputs: parent skill, support map, owner paths, config shape.

Must output: the support facts needed by the parent skill.

Stop when: the parent has enough information to continue.

Missing dependency behavior: blocked only when the parent marks this support as hard; otherwise degraded.

Runbook:

- Set `user-invocable: false` when the runtime supports it.
- Name the parent skill.
- Keep the surface read-only unless explicitly owned.
- Do not compete with the parent skill description.
- Archive when the parent skill no longer depends on it.

Examples:

- `productivity-connectors`

## Control Plane

Use for a skill that drives a state machine, ledger, staged workflow, or long-running orchestration.

Archetype: air traffic control.

Job: move a workflow through explicit states without losing safety gates or durable state.

First move: read current state.

Inputs: ledger/state file, route IDs, stage rules, owner runtime, current repo state.

Must output: next route, state update, stop reason, or handoff packet.

Stop when: terminal state, hard gate, blocked route, or required human decision.

Missing dependency behavior: blocked when state owner, runtime, or route map is missing.

Runbook:

- Name the state owner.
- Read current state first.
- Follow emitted route IDs or stage labels.
- Stop at hard gates.
- Write only through the owning runtime, ledger, or documented state file.

Examples:

- `issue-to-pr`
- `runbook-orchestrator`
- `prompt-system-workflow`

## Quality Gate

Use for a skill that reviews, tests, repairs, audits, or hardens another surface.

Archetype: checkpoint.

Job: prove whether a target is healthy enough to continue.

First move: identify the target and smallest meaningful check.

Inputs: target path, changed files, owner checks, expected evidence shape.

Must output: pass/fail, introduced findings, repair hints, and rerun evidence when changed.

Stop when: the gate passes, a blocker is found, or the next repair is named.

Missing dependency behavior: blocked when the check runner or target owner is missing.

Runbook:

- Name the target.
- Run the smallest meaningful check.
- Separate introduced findings from inherited context.
- Prefer repair hints over broad rewrites.
- Rerun the same evidence after changes.

Examples:

- `fallow`
- `test-runner`
- `heal-skill`

## Bridge

Use for a temporary compatibility skill after a rename or consolidation.

Archetype: signpost.

Job: point old requests to the new owner until old references disappear.

First move: name the new owner path.

Inputs: old skill name, new owner, removal condition, active-reference audit.

Must output: new owner route and removal condition.

Stop when: the handoff is clear or the bridge is ready for removal.

Missing dependency behavior: blocked when the new owner path is missing.

Runbook:

- Name the new owner.
- Name the removal condition.
- Avoid new workflow detail.
- Run active-reference audit before removal.
- Delete the bridge after the old name is no longer live.

Examples:

- None active by default.

## Checks

- One primary role per active skill.
- `role` appears in active `SKILL.md` frontmatter.
- Optional `abilities` use allowed labels.
- Run `bun run skills/create-skill/scripts/skill-role-audit.ts`.
- Support references do not route user requests away from their parent skill.
- Control planes name their state owner.
- Tool workflows name setup checks and blocked/degraded states.
- Bridges name a removal condition.

## Provenance Rule

- Keep `PROVENANCE.md` only when source history matters.
- Use it for imported, copied, adapted, license-bearing, upstream-derived, or lineage-heavy skills.
- Do not use `PROVENANCE.md` as a glossary.
- Do not use `PROVENANCE.md` as live workflow instructions.
- Put domain words in `CONTEXT.md`.
- Put accepted decisions in decision logs.
- Put operational routes in `SKILL.md`, references, scripts, help, or tests.
