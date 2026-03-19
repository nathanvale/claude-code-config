---
title: "QMD Query Mode Decision"
type: decision
status: active
updated: 2026-03-16
summary: "Default to lightweight local QMD recall and require explicit opt-in for full query-expansion mode."
---

# QMD Query Mode Decision

## Decision

Default to lightweight local recall modes for day-to-day use:
- `search` for keyword-first recall
- QMD MCP when the agent session exposes it

Treat full `qmd query` as an explicit opt-in mode.

## Why

- indexing works
- vectors work
- MCP works
- refresh works
- `vsearch` and full `qmd query` can trigger a much larger local model download on this machine

That larger model is useful, but it should be a deliberate choice rather than a surprise side effect of everyday recall.

## Practical Rule

Use:
- `~/.config/memory/scripts/qmd-recall.sh "topic"` for fast default recall
- `~/.config/memory/scripts/qmd-recall.sh --rich "topic"` only when you explicitly want richer query expansion and accept the larger model path

Avoid treating `vsearch` as part of the standard day-to-day workflow on this machine until its model behavior is better understood.

## Revisit Conditions

Revisit this decision if:
- the larger model has already been downloaded and becomes routine
- the richer mode consistently produces materially better recall
- `vsearch` stops pulling the larger local model path during normal use
- hardware, disk, or runtime tradeoffs become less annoying
