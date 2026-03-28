---
title: "NotebookLM Operations"
type: workflow
status: active
updated: 2026-03-28
summary: "User-scope NotebookLM workflow for curated source packs, repo-local .nlm.yml configs, and generated artifacts."
---

# NotebookLM Operations

## Goal

Use one shared NotebookLM workflow across repos while keeping notebook IDs, watch paths, and presets local to the owning repo.

NotebookLM is for:
- curated source-pack uploads
- audio overviews and podcasts
- infographics and diagram prompts
- report generation
- focused RAG queries over a selected notebook

NotebookLM is not for:
- whole-corpus uploads by default
- replacing QMD for everyday recall
- becoming the source of truth

## Ownership Model

- The shared workflow lives at user scope.
- Each repo may define a local `.nlm.yml`.
- `.nlm.yml` owns notebook IDs, watch paths, and presets for that repo.
- Source-of-truth Markdown remains in the owning repo.

## Read Order

1. `~/.config/memory/AGENTS.md`
2. `~/.config/memory/docs/memory-os-contract.md`
3. `~/.config/memory/docs/retrieval-and-synthesis.md`
4. `~/.config/memory/docs/notebooklm-source-pack-workflow.md`
5. local `.nlm.yml` in the owning repo, if present

## Default Flow

0. **Preflight:** Call `refresh_auth` to reload tokens. If any subsequent NLM call returns a 400/401/403 error, ask the user to run `! nlm login` and retry `refresh_auth` before continuing.
1. Use QMD first to recall the right notes.
2. Build or refine a small source-pack note.
3. Resolve the owning repo and read its `.nlm.yml`.
4. Choose the target notebook from `.nlm.yml`.
5. Upload only the pack note and the listed sources.
6. Generate the needed artifact.
7. Write durable conclusions back into Markdown.

## Repo-Local `.nlm.yml`

When present, `.nlm.yml` should define:
- `notebooks`
- `presets`

This lets each repo keep its own:
- notebook IDs
- upload watch paths
- audio presets
- infographic presets

## Core Operations

### `sync`

Use the owning repo's `.nlm.yml` watch paths to find new Markdown files and upload only the new additions to the selected notebook.

### `add`

Add one of:
- a file
- a URL
- a text block
- a source-pack note plus the sources it references

When adding a source-pack note:
- upload the source-pack note itself
- then upload the files listed in its frontmatter `sources`

### `query`

Run a NotebookLM query against the selected notebook after the source pack is in place.

### `audio`

Generate an audio artifact using a local preset when available.

### `infographic`

Generate a visual artifact using a local preset when available.

### `report`

Generate a written artifact when the result needs to be reviewed or written back into Markdown.

### `status`

Check artifact generation status and URLs.

### `create`

Create a new notebook, then record its ID in the owning repo's `.nlm.yml`.

## Source-Pack Rules

- Prefer thematic packs over broad dumps.
- Upload the minimum set that can answer the artifact goal.
- Include the source-pack note when it gives NotebookLM important framing.
- Exclude stale or loosely related notes.
- Prefer canonical notes and primary meeting or design docs.

## Good Example

For Pri's March 16 onboarding follow-up:
- upload the source-pack note
- upload the meeting note
- upload the Student Liability capability and extension docs
- upload the SL13 and SL03 deep dives
- generate a podcast and diagram-oriented synthesis

## Write-Back Rules

Generated artifacts are not canonical.

Write back only:
- durable summaries
- clarified understanding
- architecture prompts worth keeping
- decisions
- follow-up tasks

## Client Notes

- Claude should expose this as `/nlm`.
- Codex should expose this as the `nlm` skill.
- Both should reuse the same Memory OS rules and local `.nlm.yml` files.
