---
title: "Retrieval And Synthesis"
type: reference
status: active
updated: 2026-03-16
summary: "Role boundaries for QMD, NotebookLM, and Markdown source-of-truth repos."
---

# Retrieval And Synthesis

## Stack

- Markdown repos are the source of truth.
- QMD is the broad federated recall layer.
- NotebookLM is the selective synthesis layer.
- Skills are the repeatable operating procedures on top.

## QMD Role

Use QMD for:
- federated queries across repos
- semantic and keyword recall
- narrowing by metadata when useful
- finding candidate notes before deeper reading

Access preference:
- QMD MCP when the agent session exposes it
- local QMD wrappers in `~/.config/memory/scripts/`
- direct repo reads only as fallback

Local default:
- prefer `~/.config/memory/scripts/qmd-recall.sh` for lightweight everyday recall
- use rich `qmd query` mode only as an explicit opt-in
- keep vector-only recall out of the default workflow on this machine until its model behavior is more predictable

QMD is the default answer to:
- "What do we already know about this?"
- "Where has this topic shown up before?"
- "Which repo likely owns this context?"

## NotebookLM Role

Use NotebookLM when the goal is a generated artifact, not everyday recall.

Good use cases:
- pre-meeting briefings
- weekly rollups
- onboarding packs
- podcasts or audio overviews
- infographics
- thematic synthesis across a curated set of sources

## NotebookLM Rules

- Do not load the whole corpus by default.
- Prefer small, purpose-built source packs.
- Keep packs bounded by topic, phase, or audience.
- Write durable outputs back into Markdown if they become important.
- Do not treat a notebook as a replacement for the underlying notes.

## Recommended Flow

1. Search broadly with QMD.
2. Identify the notes, repos, and artifacts that matter.
3. Read or summarize from source.
4. If a richer artifact is needed, assemble a NotebookLM source pack.
5. If the result is durable, write it back into Markdown and link it to sources.

For canonical federated recall prompt shapes, see `memory-recall-examples.md`.
For the local query-mode policy, see `qmd-query-mode-decision.md`.
For the artifact workflow, see `notebooklm-source-pack-workflow.md`.

## Good NotebookLM Pack Examples

- "Monash onboarding pack"
- "Mac Mini network hardening phase"
- "Founder weekly strategy review"
- "This week's meetings and Slack digests"

## Bad NotebookLM Pack Examples

- "Every note from every repo"
- "All archives plus all inbox notes"
- "Everything tagged project"
