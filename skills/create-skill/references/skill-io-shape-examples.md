# Skill I/O Shape Examples

Use these as shape examples, not contracts.

Keep exact field lists, command flags, output envelopes, and validation rules in the named owner paths.

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
description: "Record accepted repo decisions through the decisions runtime."
---

# Record Decision

Use when a decision is accepted and belongs in the repo decision log.

## Owner Paths

- Pattern: `references/skill-design-philosophy.md#runtime-backed-capability-design`.
- CLI design: `skills/create-cli/SKILL.md`.
- Input contract owner path: `packages/decisions/src/record-input.ts`.
- Output transport: `@side-quest/cli-command-facade`.
- Output data owner path: `packages/decisions/src/record-output.ts`.
- Test owner path: `packages/decisions/tests/record.test.ts`.

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
