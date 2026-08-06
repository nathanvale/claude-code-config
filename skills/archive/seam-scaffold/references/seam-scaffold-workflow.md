# Seam Scaffold Workflow

Use this reference after `skills/seam-scaffold/SKILL.md` identifies the task shape.

## Modes

### Existing Seams

- Use when directories, modules, or docs already name the target seams.
- Add new work to the existing seam.
- Justify any new seam with pressure, deletion test, locality, and leverage.
- Preserve import direction already proven by tests or docs.

### Greenfield

- Use when the plan owns a new structure and target paths are clear.
- Scaffold marked shells.
- Add only identity, status, deletion-test header, exports, and guards the plan already owns.
- Avoid placeholder behavior.
- Keep implementation details for the next work step.

### Fat File

- Use when one large file hides multiple reasons to change.
- Recommend seam dirs, owner modules, and migration order.
- Leave code in place unless the user asks for moves.
- Prefer a tracer slice before fanning out.

### Refactor

- Use when existing code needs to move into clearer seams.
- Map current files to target seams before editing.
- Preserve acyclic steps.
- Move tests with their seam when moves are requested.
- Keep generated files out of the edit set.

## Pattern Verdicts

- Earned: pressure exists, owner seam is named, deletion test passes, and the second adapter or equivalent variation is real.
- Provisional: the seam is useful, but the pattern name lacks proof.
- Rejected: the name hides the actual pressure, duplicates a local term, or decorates code without leverage.

Use non-GoF locality labels when the catalog misnames the pressure.

## Handoff Packet

Illustrative shape:

```markdown
## Current State

- Files inspected:
- Existing seams:
- Tests/checks:

## Seam Map

- Seam:
- Owner path:
- Status:
- Deletion test:
- Guardrail:

## Pattern Verdicts

- Earned:
- Provisional:
- Rejected:

## Implementation Handoff

- Changed state:
- Remaining work:
- Create:
- Leave untouched:
- Tests/checks:
- Risks:
- Handback target:
- Next safe action:
```
