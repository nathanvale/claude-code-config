---
title: "Memory Recall Examples"
type: reference
status: active
updated: 2026-03-16
summary: "Canonical query patterns for federated recall across the Memory OS."
---

# Memory Recall Examples

## Purpose

Turn federated recall into a repeatable habit with a small set of canonical prompt shapes.

## Core Patterns

### 1. What Do We Already Know About X?

Use when:
- starting work on a topic
- resuming after interruption
- checking whether prior context already exists

Examples:
- "What do we already know about Mac Mini network hardening?"
- "What do we already know about Monash fee assessment?"
- "What do we already know about Nathan's weekly review process?"

Expected answer shape:
- best matching notes
- likely owning repo
- open questions or gaps

### 2. Which Repo Owns Y?

Use when:
- deciding where a new note should live
- finding the source-of-truth repo
- resolving duplication risk

Examples:
- "Which repo owns onboarding context for Monash stakeholders?"
- "Which repo owns Mac Mini verification history?"
- "Which repo should own founder/product strategy notes?"

Expected answer shape:
- likely owning repo
- why that repo is the source of truth
- what should stay local vs be promoted

### 3. Find Prior Decisions About Z

Use when:
- checking whether a decision was already made
- looking for ADRs, specs, or durable conclusions
- avoiding repeated debate

Examples:
- "Find prior decisions about remote access to the Mac Mini."
- "Find prior decisions about frontmatter shape in the Memory OS."
- "Find prior decisions about NotebookLM usage."

Expected answer shape:
- relevant decision/spec/runbook notes
- confidence level
- whether the decision still looks active

### 4. What Changed Recently About X?

Use when:
- reloading state after a break
- understanding recent progress
- preparing for a session handoff

Examples:
- "What changed recently about the Memory OS setup?"
- "What changed recently in Monash repo memory workflows?"
- "What changed recently in Mac Mini implementation planning?"

Expected answer shape:
- recent logs or hot-memory files
- likely next move
- any durable updates worth promoting

### 5. What Should I Read First?

Use when:
- entering an unfamiliar topic
- preparing a briefing
- reducing cognitive load before deeper reading

Examples:
- "What should I read first to understand the Memory OS?"
- "What should I read first to understand Monash people context?"
- "What should I read first to understand Mac Mini current state?"

Expected answer shape:
- 3 to 5 highest-signal notes
- read order
- why each note matters

## Routing Notes

- Prefer QMD MCP when available.
- Prefer QMD CLI wrappers when MCP is unavailable.
- Fall back to direct repo reads only when recall tools are unavailable or insufficient.
- Keep source-of-truth boundaries explicit in the answer.

## Anti-Patterns

- Jumping straight to NotebookLM for everyday recall.
- Answering from one snippet without identifying the owning repo.
- Creating a new note before checking whether the knowledge already exists.
