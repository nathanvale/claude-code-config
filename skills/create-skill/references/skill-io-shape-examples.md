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
- Add headings only when they improve entry-screen route clarity.
- Keep exact contracts in owner paths.
- Prefer deleting vague headings before adding new ones.

Selection strength:

- `★★★`: strong default when the Use When applies.
- `★★`: useful when it reduces ambiguity.
- `★`: optional scanning aid.
- `avoid`: usually duplicates an owner path or bloats the skill.

| Heading | Use When | Selection Strength | Notes |
|---|---|---|---|
| `Owner Paths` / `Owner` | The skill names owner paths for commands, runtimes, trackers, references, docs, or contracts. | `★★★` | Prefer `Owner Paths` when several owners exist. Use `Owner` for one. |
| `Workflow` / `Route Map` | The skill tells the agent how to act or choose a path. | `★★★` | Use `Route Map` for main-entry routing. Use `Workflow` for operator flow. |
| `Next Safe Action` | The agent may stop, hand off, repair input, or need a clear continuation. | `★★★` | Strong default for agent-native skills. |
| `Verification` | The skill has scripts, runtime behavior, generated output, audits, or repo edits. | `★★★` | Script-backed skills name a focused verification path. |
| `Safety` | The skill mutates state, touches private data, performs external actions, or has failure risk. | `★★★` | Include only when safety changes behavior. |
| `Commands` | The skill wraps CLI, tool, service, or script invocations. | `★★` | Keep exact flags in help, code, or generated docs when possible. |
| `Output Handling` | stdout, stderr, JSON, envelope, artifact, or error behavior changes the workflow. | `★★` | Common for simple operation and runtime-backed skills. |
| `Example` / `Examples` | The skill shapes model-written artifacts or output style. | `★★` | Keep examples illustrative and non-authoritative. |
| `Known Pitfalls` / `Gotchas` | Observed failures show agents repeatedly miss a non-obvious fact. | `★★` | Add from observed failure, not theoretical risk. |
| `Dependencies` / `Prerequisites` | Missing setup blocks or degrades the workflow. | `★★` | Name missing state, fallback, and next repair. |
| `Request Shape` | User input needs classification, normalization, or routing before work starts. | `★★` | Use when request shape affects owner, safety, or workflow. |
| `Output Shape` | The skill returns a specific prose report, packet, or artifact shape. | `★★` | Use `Output Contract` only when pointing at a machine-owned contract. |
| `References` / `Reference Files` | The skill has one-level detail files. | `★` | Say when to load each reference. |
| `Notes` | Miscellaneous leftover guidance. | `avoid` | Rename, prune, or move into a precise heading. |
| `Contract` | Exact flags, schemas, states, or output semantics appear in prose. | `avoid` | Use only to point at the authoritative owner path. |

## Skill I/O Example

```markdown
---
name: draft-release-notes
description: "Draft release notes when shipped changes, PR notes, issue notes, or a supplied summary are available."
---

# Draft Release Notes

Use when the user asks for release notes, changelog copy, or a shipped-change summary.

## Owner Paths

- Pattern: `references/skill-design-philosophy.md#skill-io-examples`.
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

- Pattern: `references/skill-design-philosophy.md#simple-operation-io`.
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

- Pattern: `references/skill-design-philosophy.md#runtime-backed-capability-design`.
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
