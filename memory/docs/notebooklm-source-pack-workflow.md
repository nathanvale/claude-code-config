---
title: "NotebookLM Source Pack Workflow"
type: workflow
status: active
updated: 2026-03-17
summary: "Turn federated recall into a small, reusable NotebookLM source pack and write durable conclusions back into Markdown."
---

# NotebookLM Source Pack Workflow

## Goal

Use QMD to find the right Markdown sources, then package only the highest-signal subset for NotebookLM.

This workflow is for:
- briefings
- podcasts or audio overviews
- onboarding packs
- weekly rollups
- thematic synthesis

It is not for:
- everyday recall
- full-corpus uploads
- replacing the underlying Markdown notes

## Default Flow

1. Recall broadly with QMD.
2. Select the smallest useful set of source notes.
3. Scaffold a source-pack note.
4. Upload only that curated pack to NotebookLM.
5. Write durable conclusions back into Markdown if the artifact reveals anything worth keeping.

## Recommended Recall Step

Use:

```sh
~/.config/memory/scripts/qmd-recall.sh "your topic"
```

Prefer QMD MCP when the active agent session exposes it.

## Pack Selection Rules

- Prefer canonical and recent notes.
- Include source-of-truth notes, not derivative summaries, when possible.
- Keep the pack thematic and bounded.
- Exclude stale, duplicate, or low-signal notes.
- Stop adding sources once the pack can answer the artifact goal confidently.

## Scaffold A Pack

Use:

```sh
~/.config/memory/scripts/notebooklm-pack.sh \
  --output ~/Desktop/mac-mini-briefing-pack.md \
  --title "Mac Mini Phase Briefing" \
  --goal "Create a short implementation briefing for the current Mac Mini phase." \
  --audience "Nathan" \
  --artifact "briefing" \
  --query "current Mac Mini implementation state" \
  --source "/Users/nathanvale/code/mac-mini-home-server/docs/runbooks/implementation-runbook.md" \
  --source "/Users/nathanvale/code/mac-mini-home-server/TASKS.md"
```

The scaffolded file is a working note. Edit the reasons, exclusions, and prompt direction before using it in NotebookLM.

## Good Pack Shapes

- `Monash onboarding pack`
  - team context
  - current project context
  - canonical meeting or onboarding notes
- `Mac Mini implementation briefing`
  - active spec
  - current tasks
  - implementation runbook
  - latest verification note
- `Founder weekly strategy review`
  - current priorities
  - decision notes
  - recent meeting or research notes

## Write-Back Rules

Generated artifacts are not source of truth.

Write back only:
- durable conclusions
- corrected understanding
- stable summaries
- decisions
- follow-up tasks

Write back into the repo that owns the truth. Promote upward to `my-second-brain` only when the result becomes cross-project or personally durable.
