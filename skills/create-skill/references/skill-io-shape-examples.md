# Skill I/O Shape Examples

Use these as input/output shape examples and heading examples, not contracts.

Keep exact field lists, command flags, output envelopes, and validation rules in the named owner paths.

## Preview Index

- Read `Skill I/O Example` for candidate pieces in model-readable prose workflows.
- Read `Simple Operation I/O Example` for candidate pieces in command wrapper skills.
- Read `Runtime-Backed Capability Example` for candidate pieces in script or CLI-backed skills.
- Read `Heading Selection Matrix` when choosing `SKILL.md` body headings from input/output shape.
- Stop once the skill's input/output owner, heading shape, and next safe action are clear.

## Heading Selection Matrix

Use this matrix when choosing `SKILL.md` body headings.

- Start from the skill's input/output shape, not its `role`.
- Choose only headings needed for the current branch.
- Treat the sets below as starting shapes, not cumulative checklists.
- Add a heading only when it changes first-minute route, halt, or continuation behavior.
- Keep `SKILL.md` a `thin router` for the `current step only`.
- Put branch-only detail behind a `branch-hidden reference`.
- Keep exact contracts in their `single source of truth`.
- Prefer deleting vague headings before adding new ones.
- Apply the `deletion test`: if a heading does not change selected-branch behavior, delete it or move it.
- If `Owner Map`, `Workflow`, `Next Safe Action`, `Verification`, and `Safety` all appear, file a review finding by default until each heading passes the `deletion test`.

Shape-specific starts:

| Shape | Start with | Add only when |
|---|---|---|
| Write something | One `Workflow` or `Next Safe Action` heading. | Owner paths, examples, or output style would be unclear without it. |
| Simple operation | One `Workflow` heading naming the command owner and report shape. | stdout, stderr, exit code, or command ownership changes the workflow. |
| Runtime-backed capability | One `Workflow` heading plus a blocking `Safety` line when needed. | Parsed input, machine output, durable writes, retry, or repair state changes the workflow. |
| Main-entry router | `Intent Classification`. | `Run Card` or `Owner Map` changes first-minute route, halt, or continuation behavior. |

Optional headings:

| Heading | Add only when | Delete or move when |
|---|---|---|
| `Verification` | A focused check is needed for the selected branch. | It becomes a proof matrix or repeats another owner path. |
| `Safety` | A fail-closed gate can block before action. | It is broad caution detached from the selected branch. |
| `Commands` | Command ownership or working directory affects the next action. | It copies exact flags owned by help, code, tests, or scripts. |
| `Examples` | Model-written output needs a concrete shape. | It becomes an exact contract without a machine owner. |
| `Gotchas` | Refinement evidence proves a repeated non-obvious miss. | It describes theoretical risk. |
| `Dependencies` | Missing setup blocks or degrades the workflow. | It lists background prerequisites that do not affect the next action. |
| `References` | Branch-hidden detail needs a load point. | It becomes an exhaustive owner map on the first screen. |
| `Notes` | Never as a default. | Rename, prune, or move into a precise heading. |
| `Contract` | Only to point at the authoritative owner path. | It copies exact flags, schemas, states, or output semantics. |

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

Start with one heading. Add examples only when model-written output needs shape.

```markdown
---
name: draft-release-notes
description: "Draft release notes when shipped changes, PR notes, issue notes, or a supplied summary are available."
---

# Draft Release Notes

Use when the user asks for release notes, changelog copy, or a shipped-change summary.

## Workflow

1. Read the fact input: current diff, PR notes, issue notes, or user-supplied summary.
2. If facts are missing, inspect the input artifacts before drafting.
3. Draft in the requested channel format.
4. Flag unsupported claims.
5. Use `context/comms-style.md` only when channel style is unclear.

## Example

Input:
- Added CSV export for filtered reports.
- Empty states now explain why export is unavailable.

Output:
- Added CSV export for filtered reports.
- Clarified export-disabled states when no matching rows exist.

```

## Simple Operation I/O Example

Start with one heading. Add output handling only when stdout, stderr, or exit codes change the next action.

```markdown
---
name: run-repo-check
description: "Run repository checks when the user asks for lint, format check, type check, or full repo validation."
---

# Run Repo Check

Use when the user asks to run the repo check, lint, format check, or type check.

## Workflow

1. Read the command from `package.json`.
2. Run it from the repo root.
3. If the command is missing, inspect the owner path before inventing a replacement.
4. Treat stdout as the user-facing result.
5. Treat stderr as diagnostics.
6. Treat non-zero exit as a repair path.
```

## Runtime-Backed Capability Example

Start with workflow plus one blocking safety line when durable writes or external side effects are present.

```markdown
---
name: record-decision
description: "Record accepted repo decisions through the record-decision runtime."
---

# Record Decision

Use when a decision is accepted and belongs in the repo decision log.

## Workflow

1. Read input contract owner `packages/record-decision/src/record-input.ts`.
2. If the contract owner path is missing, stop and run `create-cli`.
3. Build the prose input envelope.
4. Run the command named by the CLI owner.
5. Follow the returned next safe action.

## Safety

- Default to dry-run.
- Require explicit execute mode for durable writes.
- Route repair envelopes back to input changes.
```
