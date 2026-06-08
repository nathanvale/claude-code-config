---
name: capture
description: "Capture new information into the shared Memory OS. Use when importing a photo, pasted text, artifact, markdown note, research, review, plan, or real-world event and you want memory output, document output, or both. Not for summarizing-only, transcription, or promotion review."
argument-hint: "[memory|doc|both] [topic, artifact, or pasted content]"
disable-model-invocation: true
---

# Capture

Use the shared Memory OS contract at `~/.config/context/AGENTS.md`.

## Goal

Provide one front door for new information so the user does not need to choose between memory systems.

Default behavior:
- infer whether the input should become `context/`, `docs/`, or both
- ask one short clarifying question only when confidence is low
- preserve provenance when the source is external

## Read Order

1. `~/.config/context/AGENTS.md`
2. `~/.config/context/docs/memory-os-contract.md`
3. `~/.config/context/docs/review-note-contract.md`
4. `~/.config/context/docs/repo-profiles.md`
5. `~/.config/context/docs/productivity-integration.md`
6. Relevant repo-local instructions if the target repo is known

## Memory Model

Treat these as separate layers with different jobs:

- `CLAUDE.md` -> hot memory for a few broadly relevant repo cues
- `context/` -> deep recall memory for compact durable context
- `docs/` -> full authored documents

Do not create or depend on PARA folders as the primary storage model.

## Modes

The user can force a mode:

- `memory` -> write only durable memory outputs
- `doc` -> write only authored document outputs
- `both` -> write a full document and a compact memory summary

If no mode is specified, route automatically.

## Routing Rules

### Prefer `context/`

Use `context/` when the primary outcome is compact recall or decoding support:

- people context
- project summaries
- glossary terms, acronyms, nicknames, aliases
- durable preferences
- critical life or work context extracted from messy real-world inputs
- brief incident summaries where the long-form artifact is not the main thing

Typical homes:
- `context/glossary.md`
- `context/people/`
- `context/projects/`
- `context/context/`

Promote a short pointer into `CLAUDE.md` only when the information becomes high-frequency and broadly relevant across most sessions in that repo.

### People Note Contract

When a capture updates a person, treat `context/people/*.md` as one canonical note system shared with `productivity-sync` and `/people-enrich`.

For people-related captures:
- do not freehand edit `context/people/*.md`
- prepare structured JSON and call `~/.claude/skills/people-enrich/scripts/apply-person-update.ts`
- write durable observations to `## Signals`
- write ambiguity, conflicts, or follow-up review items to `## Open Questions`
- keep `## Relationship Profile` updates conservative and H3-scoped
- never paste raw message logs or transcript dumps into durable people notes
- prefer a short durable signal over a miniature dossier

Structured payload example:

```json
{
  "signals": [
    "2026-03-22: Mentioned Easter lunch plan; source: iMessage"
  ],
  "open_questions": [
    "Confirm whether the lunch is Easter Sunday or Easter Monday."
  ],
  "source_handles": {
    "email": ["mel@example.com"]
  }
}
```

Safe dry-run proof:

```bash
bun run ~/.claude/skills/people-enrich/scripts/apply-person-update.ts \
  --people-dir ~/code/my-second-brain/context/people \
  --source imessage \
  --handle +61412667520 \
  --report /tmp/person-update.json \
  --output /tmp/person-update.preview.md
```

Review the preview first. Only switch to `--write` after the proposed note matches the contract.

### Prefer `docs/`

Use `docs/` when the primary outcome is an authored document the user will want to read, edit, or revisit in full:

- research notes
- review notes
- plans and itineraries
- specs
- decisions
- logs
- artifact transcriptions or structured writeups

Typical homes:
- `docs/research/`
- `docs/reviews/`
- `docs/plans/`
- `docs/specs/`
- `docs/decisions/`
- `docs/logs/`
- `docs/artifacts/`

Use these nearby note families deliberately:

- `review` for evaluating a change, artifact, system, or workflow against explicit criteria
- `plan` for evolving options, sequencing, itineraries, and future-facing decision documents
- `spec` for more settled canonical documents that describe the shape to execute against

### Use `both`

Use both outputs when the material has a long-form document and a compact durable summary:

- trip plans with an ongoing summary note
- medical or family events with a full incident note plus key durable context
- research that should also update a project or person memory note
- imported markdown files that should be preserved as docs but surfaced as concise memory

In `both` mode:
1. create or update the full document in `docs/`
2. create or update a compact summary in `context/`
3. update `CLAUDE.md` only if the information is high-frequency enough to matter in daily decoding

## Repo Resolution

Before writing anything:

1. Resolve the owning repo.
2. Keep repo-specific memory local by default.
3. Use `my-second-brain` only for life-hub material, cross-project synthesis, or personally durable memory.
4. If the current repo is not clearly the owner, do not assume it is.

## Classification Questions

For every capture, decide:

1. Who owns this?
2. Is the primary output compact memory, an authored document, or both?
3. Is the material semantic, episodic, or runtime?
4. What is the smallest useful note family?
5. What provenance should be preserved?
6. Should any part of this be promoted into `CLAUDE.md` as a short hot-memory pointer?

## Note Families

Map captures back to the shared note families whenever possible:

- `project`
- `area`
- `person`
- `pet`
- `meeting`
- `research`
- `review`
- `task`
- `decision`
- `adr`
- `plan`
- `spec`
- `runbook`
- `log`
- `artifact-sidecar`

Use `status` to represent lifecycle such as `planned`, `active`, `done`, or `archived`.

## Minimum Frontmatter

Use the smallest shape that helps retrieval:

```yaml
---
title: "Human-readable title"
type: note-type
status: active
updated: YYYY-MM-DD
summary: "Optional retrieval summary"
source: /path/to/source
source_system: photos|email|calendar|drive|repo
source_id: external-id
source_url: https://example.com
related:
  - path/to/related-note.md
---
```

## Provenance Rules

Preserve provenance whenever the material comes from:

- pasted screenshots or photos
- email
- calendar
- trackers
- drive documents
- imported markdown files
- copied web content

Prefer the smallest useful provenance fields. Do not scatter raw links across many notes.

If an imported file becomes the new canonical copy in the owning repo, do not keep a stale `source:` pointer to a retired repo just because the content originated there. Keep provenance only when it still helps future retrieval or auditing.

## Workflow

### Step 1: Parse Intent

Check whether the user explicitly asked for:

- `memory`
- `doc`
- `both`

If not explicit, infer the best route from the input.

### Step 2: Resolve Owner

Identify the source-of-truth repo before writing anything.

### Step 3: Choose Output Shape

Pick one:

- `context/`
- `docs/`
- both

### Step 4: Place The Result

Route by content type:

- people, glossary, project summaries, preferences -> `context/`
- research, reviews, plans, specs, decisions, logs, artifacts -> `docs/`
- mixed cases -> both

When writing `context/projects/`, use lowercase hyphenated slugs and prefer domain-prefixed names when they improve findability, such as `holiday-fnq-july-2026.md`, not generated names like `project_fnq_july_2026.md`.

### Step 5: Preserve Provenance

Add source fields or create an `artifact-sidecar` when needed.

### Step 6: Consider Promotion

Only add or update `CLAUDE.md` when the captured information will materially help day-to-day decoding or execution.

## Default Heuristics

Use these defaults unless the user says otherwise:

- photo of a referral, form, receipt, or message -> `memory` or `both`
- pasted shorthand, acronym, nickname, person context -> `memory`
- research dump -> `doc`
- imported markdown plan or itinerary -> `both`
- meeting artifact that needs a proper writeup -> `doc` or `both`
- durable project summary update -> `memory`
- imported planning documents that remain option-heavy -> `doc` or `both` with `type: plan`
- imported planning documents that are now the settled canonical operating copy -> `doc` or `both` with `type: spec`

## Shape Heuristics

Use this decision ladder:

1. Inline
   - Use when the content is short, stable, and best understood inside the parent note.
   - Good default for simple bookings, one-off references, and compact status detail.
2. `artifact-sidecar`
   - Use when the content is mainly an external artifact with provenance.
   - Good for confirmations, receipts, PDFs, email threads, transcripts, and exported reports.
   - Strong signal: IDs, dates, terms, links, attachments, or status detail worth preserving.
3. Standalone note
   - Use when the subtopic has independent meaning or follow-up.
   - Strong signal: more than one expected update, more than one artifact, its own tasks or decisions, or likely direct search/linking later.

When uncertain, choose the smaller shape and mention when to split it later.

## Examples

### Example: Real-World Artifact

Input:
- photo of a doctor referral for Levi after an emergency visit

Route:
- default to `both` if the event matters beyond the raw image

Write:
- durable family/medical context in `context/`
- dated incident or artifact note in `docs/logs/` or `docs/artifacts/`

### Example: Research Session

Input:
- pasted research notes about a product or workflow

Route:
- default to `doc`

Write:
- `docs/research/YYYY-MM-DD-topic.md`
- optional `context/` summary only if it becomes durable and cross-context

### Example: Travel Plan Import

Input:
- a batch of markdown itinerary files

Route:
- default to `both`

Write:
- full itinerary docs in `docs/plans/`
- compact trip summary in `context/projects/`

## Output Shape

When asked to recommend placement, respond with:

- Recommended home
- Output mode: `memory`, `doc`, or `both`
- Memory layer: semantic, episodic, or runtime
- Note family
- Proposed paths
- Minimum frontmatter
- Provenance needs
- `CLAUDE.md` promotion recommendation

## Rules

- Prefer one capture flow over multiple user-facing routing decisions.
- Prefer source-of-truth repos over dumping into `my-second-brain`.
- Prefer the smallest useful metadata shape.
- Prefer `docs/` for long-form authored material.
- Prefer `context/` for compact durable recall.
- Use `both` when the user benefits from a full document plus a concise memory summary.
