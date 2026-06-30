# Skill I/O Shape Examples

Use these as input/output shape examples and heading examples, not contracts.

Keep exact field lists, command flags, output envelopes, and validation rules in the named owner paths.

## Preview Index

- Read `Skill I/O Example` for model-readable prose workflows.
- Read `Simple Operation I/O Example` for command wrapper skills.
- Read `Runtime-Backed Capability Example` for script or CLI-backed skills.
- Read `Heading Selection Matrix` when choosing `SKILL.md` body headings from input/output shape.
- Stop once the skill's input/output owner, heading shape, and next safe action are clear.

## Heading Selection Matrix

Use this matrix when choosing `SKILL.md` body headings.

- Start from the skill's input/output shape, not its `role`.
- Treat stars as selection strength, not a required schema.
- Strong default does not mean include all strong headings.
- Add headings only when they improve entry-screen route clarity.
- Keep `SKILL.md` a `thin router` for the `current step only`.
- Put branch-only detail behind a `branch-hidden reference`.
- Keep exact contracts in their `single source of truth`.
- Prefer deleting vague headings before adding new ones.
- Apply the `deletion test`: if a heading does not change selected-branch behavior, delete it or move it.

Selection strength:

- `★★★`: strong default when the Use When applies.
- `★★`: useful when it reduces ambiguity.
- `★`: optional scanning aid.
- `avoid`: usually duplicates an owner path or bloats the skill.

| Heading | Use When | Selection Strength | Notes |
|---|---|---|---|
| `Owner Map` / `Owner Paths` / `Owner` | The skill names owner paths for commands, runtimes, trackers, references, docs, or contracts. | `★★★` | Use a small first-screen routing map only. Put exhaustive owner lists in references unless needed for the next action. |
| `Pick One` / `Workflow` | The skill maps request shapes or tells the agent how to act. | `★★★` | Use `Pick One` for main-entry routing. Use `Workflow` for hot-path current-step flow only. |
| `Next Safe Action` | The agent may stop, hand off, repair input, or need a clear continuation. | `★★★` | Strong default for agent-native skills. |
| `Verification` | The skill has scripts, runtime behavior, generated output, audits, or repo edits. | `★★★` | Name a focused verification command for the selected branch. Keep proof matrices in owner paths or references. |
| `Safety` | The skill mutates state, touches private data, performs external actions, or has failure risk. | `★★★` | Include immediate fail-closed gates only. |
| `Commands` | The skill wraps CLI, tool, service, or script invocations. | `★★` | Keep exact flags in help, code, generated docs, tests, or scripts. |
| `Output Handling` | stdout, stderr, JSON, envelope, artifact, or error behavior changes the workflow. | `★★` | Common for simple operation and runtime-backed skills. |
| `Example` / `Examples` | The skill shapes model-written artifacts or output style. | `★★` | Keep examples illustrative and non-authoritative. |
| `Gotchas` / `Known Pitfalls` | Refinement evidence shows agents repeatedly miss a non-obvious fact. | `★★` | Add from refinement evidence, not theoretical risk. |
| `Dependencies` / `Prerequisites` | Missing setup blocks or degrades the workflow. | `★★` | Name missing state, fallback, and next repair. |
| `Request Shape` | User input needs classification, normalization, or routing before work starts. | `★★` | Use when request shape affects owner, safety, or workflow. |
| `Output Shape` | The skill returns a specific prose report, packet, or artifact shape. | `★★` | Use `Output Contract` only when pointing at a machine-owned contract. |
| `References` / `Reference Files` | The skill has branch detail, rare paths, examples, owner maps, troubleshooting, or review criteria. | `★★★` | Preferred place for `branch-hidden reference` detail. Say when to load each reference. |
| `Notes` | Miscellaneous leftover guidance. | `avoid` | Rename, prune, or move into a precise heading. |
| `Contract` | Exact flags, schemas, states, or output semantics appear in prose. | `avoid` | Use only to point at the authoritative owner path. |

## Thin Router Example

Illustrative only.

Bad pattern:

- `SKILL.md` includes exhaustive owners, trust model, command contracts, schema notes, and all branch workflows.
- The agent loads detail for branches it has not selected.
- The `single source of truth` drifts because prose restates code, help, tests, or scripts.

Good pattern:

- `SKILL.md` routes the current request and stops after the next safe action.
- `SKILL.md` names one owner anchor when route, halt, or continuation depends on it.
- Branch-only detail lives behind a `branch-hidden reference`.
- Exact flags, schemas, states, output envelopes, and deterministic contracts stay in code, CLI help, generated docs, tests, or scripts.

## Skill I/O Example

```markdown
---
name: draft-release-notes
description: "Draft release notes when shipped changes, PR notes, issue notes, or a supplied summary are available."
---

# Draft Release Notes

Use when the user asks for release notes, changelog copy, or a shipped-change summary.

## Owner Paths

- Pattern: `references/skill-design-decision-runbook.md#write-something-skill-io-example`.
- Style guide: `context/comms-style.md`.
- Fact input: current diff, PR notes, issue notes, or user-supplied summary.

## Workflow

1. Read the fact input.
2. Draft in the requested channel format.
3. Flag unsupported claims.
4. Check the example shape before final output.

## Example

Input:
- Added CSV export for filtered reports.
- Empty states now explain why export is unavailable.

Output:
- Added CSV export for filtered reports.
- Clarified export-disabled states when no matching rows exist.

## Next Safe Action

- If facts are missing, inspect the input artifacts before drafting.
```

## Simple Operation I/O Example

```markdown
---
name: run-repo-check
description: "Run repository checks when the user asks for lint, format check, type check, or full repo validation."
---

# Run Repo Check

Use when the user asks to run the repo check, lint, format check, or type check.

## Owner Paths

- Pattern: `references/skill-design-decision-runbook.md#run-a-command-simple-operation-io`.
- Command owner path: `package.json`.
- Test owner path: repo check tests or CI workflow.

## Workflow

1. Read the command from the owner path.
2. Run it from the repo root.
3. Report exit code, stdout summary, and stderr diagnostics.

## Output Handling

- Treat stdout as the user-facing result.
- Treat stderr as diagnostics.
- Treat non-zero exit as a repair path.

## Next Safe Action

- If the command is missing, inspect the owner path before inventing a replacement.
```

## Runtime-Backed Capability Example

```markdown
---
name: record-decision
description: "Record accepted repo decisions through the record-decision runtime."
---

# Record Decision

Use when a decision is accepted and belongs in the repo decision log.

## Owner Paths

- Pattern: `references/skill-design-decision-runbook.md#use-a-reliable-tool-runtime-backed-capability`.
- CLI design: `skills/create-cli/SKILL.md`.
- Input contract owner path: `packages/record-decision/src/record-input.ts`.
- Output transport: `@side-quest/cli-command-facade`.
- Output data owner path: `packages/record-decision/src/record-output.ts`.
- Test owner path: `packages/record-decision/tests/record.test.ts`.

## Workflow

1. Read the input contract owner path.
2. Build the prose input envelope.
3. Run the command named by the CLI owner path.
4. Follow the returned next safe action.

## Safety

- Default to dry-run.
- Require explicit execute mode for durable writes.
- Route repair envelopes back to input changes.

## Next Safe Action

- If the contract owner path is missing, stop and run `create-cli`.
```
