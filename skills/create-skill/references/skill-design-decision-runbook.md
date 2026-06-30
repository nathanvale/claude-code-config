# Skill Design Decision Runbook

Use when creating, healing, repairing, or patching portable `SKILL.md` files.

Path base: `skills/create-skill/`.
Vocabulary owner: `CONTEXT.md`.

## Start Here

- Name the request shape or task family.
- Name the stressed operator.
- Name the wrong decision this skill prevents.
- Name the smallest useful intervention.
- Name the top ship-but-fail scenario.
- Run the input/output gate.
- Choose the smallest branch reference.
- Open only the branch reference needed for the current step.
- Keep `SKILL.md` a `thin router` for the `current step only`.
- Put branch-only detail behind a `branch-hidden reference`.
- Apply the `deletion test`: if removal does not change current-branch behavior, delete the text or move it behind a context pointer.
- Stop once owner path, verification, and next safe action are clear.

## Input/Output Gate

Use before create, fix, heal, repair, or patch edits.

- Name the request input: user prompt, target file, owner path, issue, artifact, command output, or external source.
- Name the working input: files, tools, state, examples, or runtime evidence the skill reads.
- Name the output shape: prose answer, findings report, source patch, command result, generated artifact, durable write, external action, or handoff.
- Name the output owner: final response, source file, reference file, generated doc, CLI/runtime owner, tracker, or external service.
- Name missing-input behavior: inspect owner path, assume low-risk default, ask one question, return blocked state, or return degraded state.
- Inspect the target skill and named owner paths before asking.
- Push back when missing shape would invent facts, choose the wrong owner, create an unowned contract, hide side effects, broaden scope, or fake verification.
- Keep exact fields, flags, schemas, states, and output semantics in code, help, generated docs, tests, or scripts.

## Branch Index

Open only the branch needed for the current step.

| Current step | Open |
|---|---|
| Choose model lane, self invocation lane, trigger text, or frontmatter | `references/skill-frontmatter-gate.md` |
| Shape `SKILL.md`, headings, no-args behavior, run card, examples, or branch-hidden references | `references/skill-body-shape-gate.md`; `references/skill-io-shape-examples.md` only when heading shape is unclear |
| Name or repair owner paths, references, contracts, or path authority | `references/skill-owner-path-gate.md` |
| Add or review safety gate, gotcha, private data boundary, destructive action, or side effect | `references/skill-safety-gate.md` |
| Choose verification, handoff, YAML parse, description audit, role audit, owner-path check, or startup check | `references/skill-verification-gate.md` |
| Add runtime behavior, CLI surface, helper command, machine output, durable write, or repair envelope | `references/agent-native-skill-design.md`; `references/runtime-portability.md`; `skills/create-cli/SKILL.md` |
| Add MC Porter skill guidance | `references/mcporter-skill-design.md` |
| Choose role or dependency behavior | `references/skill-roles.md`; `references/skill-dependency-rules.md` |
| Archive, merge, or retire a skill | `references/archive-cleanup.md`; `references/consolidation-map.md` |
| Import external input or community-skill research | `references/research-portability.md`; `references/community-skill-research-sources.md` |
| Review only | `references/skill-review-rubric.md` |

## Pick The Shape

- Choose the smallest shape that handles the risk.
- Fail upward when side effects, private data, durable writes, ownership decisions, external action, or autonomous recovery enter the flow.
- Use the higher-risk shape unless a runtime owner proves the smaller shape enforces the safety boundary.
- Use `references/skill-io-shape-examples.md` when heading shape, output handling, or contract ownership is unclear.

## Composition

- Skills do not invoke other skills automatically.
- Compose through explicit handoff from a skill driver.
- Name the skill driver.
- Callee does one job.
- Hand back changed state, remaining work, blocked condition, handback target, and next safe action.
- For create-skill self-healing, continue in the current invocation, name the owner path, patch the smallest fix, and validate.
- Use lifecycle hooks only when the runtime owns the event.

## Quality Checks

- Prefer prune or substitute before adding instructions.
- Prefer `thin router` shape over complete first-screen coverage.
- Strong default headings are options, not a checklist.
- Treat copied example heading sets as draft material until the `deletion test` proves each heading changes selected-branch behavior.
- Branch-only detail belongs in a `branch-hidden reference`.
- Run the `deletion test` against the `current step only`.
- Choose a scoped audit target; do not audit the whole repo from runbook changes alone.
- During skill review or healing, remove stale skill bridges when active route evidence no longer requires them.
- Mark personal/local assumptions explicitly.
- Do not redefine agent persona or override higher-priority instructions.
- Omit install boilerplate, changelogs, licenses, TODOs, and generated filler from `SKILL.md`.

## Next Safe Action

- Open the smallest branch reference from the index.
- Patch only the current branch.
- Run the branch-owned verification from `references/skill-verification-gate.md`.
