---
name: memory-promote
description: Evaluate whether repo-local knowledge should be promoted into my-second-brain and describe the smallest durable promoted form. Use when reviewing notes, sessions, meetings, or implementation history for lasting value.
argument-hint: [note path, topic, or summary]
disable-model-invocation: true
---

# Memory Promote

Use the shared Memory OS contract at `~/.config/memory/AGENTS.md`.

## Goal

Promote only durable, cross-context knowledge into `my-second-brain`.

## Read Order

1. `~/.config/memory/docs/memory-os-contract.md`
2. `~/.config/memory/docs/repo-profiles.md`
3. Relevant source note or repo context

## Workflow

1. Identify the source-of-truth owner.
2. Ask whether the material is durable, cross-project, hard to rediscover, or personally strategic.
3. If yes, recommend the smallest promoted artifact.
4. If no, keep it local and explain why.

## Output Shape

- Promote or keep local
- Why
- Suggested target note type
- Suggested title or placement
- Links that must be preserved

## Rules

- Do not duplicate large local corpora.
- Promote insights, patterns, and durable decisions, not routine churn.
- Preserve a clear source link back to the owning repo.
