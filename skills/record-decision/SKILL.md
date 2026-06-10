---
name: record-decision
description: "Record accepted decisions in docs/decisions as Markdown decision logs with fenced YAML."
role: tool-workflow
---

# Record Decision

Use when the user asks to log, record, preserve, or store an accepted decision.
Use when a session needs durable handoff memory for accepted implementation decisions.

Do not use for live decision-making. Route unresolved choices to `decision-mode`.

## Owner

- Decision logs: `docs/decisions/`.
- Operating manual: `references/operating-manual.md`.
- Source brainstorm: `docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md`.
- Decision trail: `docs/decisions/2026-06-06-001-decisions-skill-decision-log.md`.
- Helper CLI design: run `create-cli` before implementation.

## Dependencies

- `docs/decisions/`: hard dependency for persisted decisions.
- `references/operating-manual.md`: bundled reference.
- `decision-mode`: optional handoff for unresolved choices.
- `create-cli`: hard dependency before implementing or changing helper CLI behavior.
- Missing `docs/decisions/`: blocked for persistence. Default fallback: create `docs/decisions/`, then proceed with the workflow. If the user opts to skip creation, produce a draft entry in-session only and tell them it is not persisted.
- Missing optional handoff: continue only for already accepted decisions.

## Workflow

1. Confirm the decision is accepted or explicitly requested for preservation.
2. Name the decision in one sentence.
3. Identify the decision surface.
4. Find the same-surface decision log under `docs/decisions/`.
5. Create a same-day sequenced log if none exists.
6. Append one decision entry with fenced YAML plus prose.
7. Run the checker when available.
8. Report the decision, file path, and next action.

## Storage Rules

- Store accepted decisions only.
- Use `status: accepted` for current decisions.
- Use `status: superseded` only when a later accepted decision replaces an earlier one.
- Store rejected ideas only when the user asks to preserve them.
- Record rejected ideas as accepted exclusion decisions, not `status: rejected`.
- Keep unresolved ideas in top-level `Notes`.
- Put future improvements in each entry's `V2 Ideas`.
- Escalate to ADR only when the decision is hard to reverse, surprising without context, and a real trade-off.
- Escalate to `CONTEXT.md` only when durable domain language is resolved.
- Keep deterministic contracts out of decision prose.

## Log Shape

- Read `references/operating-manual.md` before creating a new decision log.
- New logs include frontmatter, `Frame`, and `Notes`.
- Entries include:
  - fenced YAML
  - `Decision`
  - `Rationale`
  - `Consequences`
  - `Next`
  - `V2 Ideas`
- Use frontmatter `slug` as the decision ID prefix.
- Use `source` as a list of paths or short human labels.
- Keep per-decision `owner` scalar.
- Use optional `scope` only when it narrows `owner`.
- Include `decision_mode` only when the decision came from `decision-mode`.

## Helper

- V1 helper intent: `record-decision check <file> --json`.
- Treat that command as provisional until `create-cli` finalizes it.
- V1 helper is read-only.
- V1 helper checks one file only.
- V1 helper requires JSON output.
- Exact parser rules, result shape, diagnostics, and exit codes belong in code.

## Compatibility

- Apply the new shape to new logs.
- Do not assume historical logs already match the new shape.
- Do not run repo-wide migration without an explicit decision.
