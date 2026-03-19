---
name: notebooklm-pack
description: Curate a small, high-signal source pack for NotebookLM and define the intended artifact to generate. Use when creating briefings, podcasts, onboarding packs, infographics, or other synthesized outputs from Markdown knowledge.
argument-hint: [goal or artifact]
disable-model-invocation: true
---

# NotebookLM Pack

Use the shared Memory OS contract at `~/.config/memory/AGENTS.md`.

## Goal

Prepare a selective NotebookLM source pack instead of loading the whole corpus.

## Read Order

1. `~/.config/memory/docs/memory-os-contract.md`
2. `~/.config/memory/docs/retrieval-and-synthesis.md`
3. `~/.config/memory/docs/notebooklm-source-pack-workflow.md`

## Workflow

1. Recall broadly with QMD or QMD MCP first.
2. Define the artifact goal.
3. Identify the minimum source set needed.
4. Exclude unrelated or stale context.
5. Scaffold a source-pack note with `~/.config/memory/scripts/notebooklm-pack.sh`.
6. Preserve source-of-truth links.
7. Recommend what, if anything, should be written back into Markdown after generation.

## Output Shape

- Artifact goal
- Recommended source pack
- Why each source belongs
- Exclusions
- Write-back recommendation

## Rules

- Keep packs thematic and bounded.
- Prefer recent and canonical sources.
- Prefer source-of-truth notes over derivative summaries when possible.
- Generated artifacts do not become source of truth until written back into Markdown.
