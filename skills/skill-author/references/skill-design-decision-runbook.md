# Skill Design Decision Runbook

Use when creating, reviewing, healing, repairing, or patching portable
`SKILL.md` files.

Path base: `skills/skill-author/`.
Vocabulary owner: `CONTEXT.md`.

## Start Here

Use this list as driver scratch. Do not copy it into `SKILL.md` or handoff
text.

- Name the request shape or task family.
- Name the overloaded actor: agent, user, runtime, maintainer, or reviewer.
- Name the wrong decision this skill prevents.
- Name the smallest useful intervention.
- Name the top false-success scenario: complete-looking skill, failed route,
  safety, owner, output, or verification.
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
| Create a tiny prose skill | `references/skill-frontmatter-gate.md`; `references/skill-body-shape-gate.md`; `references/skill-io-shape-examples.md` only when heading shape is unclear |
| Create a runtime-backed skill | `references/skill-safety-gate.md`; `references/agent-native-skill-design.md`; `references/runtime-portability.md`; `skills/cli-author/SKILL.md`; then `references/skill-frontmatter-gate.md`; `references/skill-body-shape-gate.md`; `references/skill-io-shape-examples.md` only when heading shape is unclear |
| Choose model lane, self invocation lane, trigger text, or frontmatter | `references/skill-frontmatter-gate.md` |
| Shape `SKILL.md`, headings, no-args behavior, run card, examples, or branch-hidden references | `references/skill-body-shape-gate.md`; `references/skill-io-shape-examples.md` only when heading shape is unclear |
| Name or repair owner paths, references, contracts, or path authority | `references/skill-owner-path-gate.md` |
| Add or review safety gate, gotcha, private data boundary, destructive action, or side effect | `references/skill-safety-gate.md` |
| Choose verification, handoff, YAML parse, description audit, owner-path check, or instruction-route proof | `references/skill-verification-gate.md` |
| Add runtime behavior, CLI surface, helper command, machine output, durable write, external side effect, or repair envelope to an existing skill or runtime owner | `references/skill-safety-gate.md`; `references/agent-native-skill-design.md`; `references/runtime-portability.md`; `skills/cli-author/SKILL.md` |
| Add MC Porter skill guidance | `references/mcporter-skill-design.md` |
| Choose dependency behavior | `references/skill-dependency-rules.md` |
| Archive, merge, or retire a skill | `references/archive-cleanup.md`; `references/consolidation-map.md` |
| Import external input or community-skill research | `references/research-portability.md`; `references/community-skill-research-sources.md` |
| Review only | Target `SKILL.md`; `references/skill-review-rubric.md` |

## Pick The Shape

- Choose the smallest shape that handles the risk.
- Default new prose-only skills to the tiny prose branch; omit Run Cards and references unless the selected branch earns them.
- Fail upward when side effects, private data, durable writes, ownership decisions, external action, or autonomous recovery enter the flow.
- Use the higher-risk shape unless a runtime owner proves the smaller shape enforces the safety boundary.
- For a new runtime-backed skill, design the runtime owner first, then pass the new `SKILL.md` through frontmatter and body gates before writing source.
- Use `references/skill-io-shape-examples.md` when heading shape, output handling, or contract ownership is unclear.

## Composition

- Skills do not invoke other skills automatically.
- Compose through explicit handoff from a skill driver.
- Name the skill driver.
- Callee does one job.
- Hand back changed state, remaining work, blocked condition, handback target, and next safe action.
- For skill-author self-healing, continue in the current invocation, name the owner path, patch the smallest fix, and validate.
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
- For create, fix, heal, repair, or patch source edits, record the `deletion test` result before handoff: kept, moved, deleted, or none.
- Run the branch-owned verification from `references/skill-verification-gate.md`.
