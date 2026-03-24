---
name: memory-capture
description: Decide where a new piece of Markdown memory should live, which note type it should use, and how provenance should be preserved. Use when creating a note, importing an artifact, or deciding whether something belongs in a repo or in my-second-brain.
argument-hint: [topic or note candidate]
disable-model-invocation: true
---

# Memory Capture

Use the shared Memory OS contract at `~/.config/memory/AGENTS.md`.

## Goal

Place new information in the right home with the lightest useful structure.

Prefer `/capture` as the default front door for new capture work.
Use this skill as the routing policy behind `/capture`, or when the user explicitly wants placement guidance.

## Read Order

1. `~/.config/memory/docs/memory-os-contract.md`
2. `~/.config/memory/docs/repo-profiles.md`
3. Relevant repo-local instructions if the target repo is known

## Workflow

1. Identify the likely source-of-truth repo.
2. Decide whether the primary output belongs in `memory/`, `docs/`, or both.
3. Classify the note into a shared note family.
4. Decide the smallest useful shape: inline, `artifact-sidecar`, or standalone note.
5. Decide whether the information is semantic, episodic, or runtime.
6. Preserve provenance if an external artifact is involved.
7. Explain whether this should stay local, become a sidecar, become a standalone note, or be promoted later.

## Output Shape

- Recommended home
- Output mode: `memory`, `doc`, or `both`
- Memory layer
- Note family
- Shape decision
- Proposed path
- Minimum frontmatter
- Provenance needs
- Promotion recommendation

## Rules

- Prefer source-of-truth repos over dumping into `my-second-brain`.
- Prefer the smallest useful metadata shape.
- Prefer `docs/` for full authored documents such as research, plans, specs, decisions, logs, and artifacts.
- Prefer `memory/` for compact durable recall such as people, glossary, project summaries, and context.
- Use `both` when the user benefits from a full document plus a compact memory summary.
- Default to inline inside an existing note when the information is small, contextual, and unlikely to be searched for on its own.
- Map animal care and durable pet context to the shared `pet` family rather than inventing a bespoke local type.
- If an external file is involved, recommend an `artifact-sidecar` rather than scattering raw links.
- Recommend a standalone note only when the subtopic has its own lifecycle, multiple updates, multiple artifacts, or direct retrieval value.
- Do not route new material into PARA storage folders in this repo.

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
