---
title: "ADHD Coach Hooks for Claude Code"
type: plan
status: parked
updated: 2026-03-23
summary: "Hook-based ADHD focus system — missions, momentum tracking, cognitive load guards. Concept strong, product not ready."
source: hooks/adhd/adhd-coach.py
source_system: repo
---

# ADHD Coach Hooks

A Python hook that runs across Claude Code lifecycle events to manage ADHD focus. Treats coding sessions like quests with missions, momentum XP, and guardrails against context-switching.

## What It Did

### Mission System
- **MISSION** control token prompts quest selection (auto-suggests from git branch, open PRs, pending todos)
- **COMPLETE_MISSION** / **PAUSE_MISSION** / **SWITCH_MISSION** for lifecycle
- Single-threaded — nudge or block when switching repos mid-mission
- 25-item or 15-minute default cap per mission
- Stale missions auto-prune after 24 hours

### Focus Modes
- **off** — no guardrails
- **nudge** (default) — gentle reminders, no blocking
- **strict** — hard blocks on context-switching, requires closeout before stopping

### Momentum Tracking
- Counts Edit/Write operations per mission
- Milestone notifications at 5, 10, 20, 25 edits ("XP +N")
- macOS notifications for dopamine hits

### Cognitive Load Guards
- Tracks active subagents — warns when >2 running
- Blocks dangerous commands (rm -rf, git reset --hard, etc.)
- Permission/idle notifications with mission context

### Session Lifecycle
- **SessionStart** — resume active mission or prompt for new one
- **PreCompact** — preserve mission context through compaction
- **Stop** — require 3-line closeout (done, risk, next action) in strict mode
- **PostToolUseFailure** — recovery coach with 3 options

### Per-Repo Policy
- `.claude/adhd-hooks.json` in any repo could override mode or disable entirely

## What Worked

- Mission framing helps set intention before diving in
- Edit milestone notifications are genuinely motivating
- Closeout requirement forces reflection
- macOS notifications catch attention when terminal is backgrounded

## Why It's Parked

- Too much noise in nudge mode — context injection on every event adds cognitive load instead of reducing it
- Mission system too rigid — real work doesn't fit neatly into 25-item boxes
- Xero-specific logic baked in (reconciliation backlog detection) — should be generic
- Control tokens (ADHD_OFF, MISSION, etc.) feel clunky as UX
- Dangerous command blocking duplicates what git-safety.ts already does
- State management via JSON file is fragile — race conditions between sessions

## Ideas for Next Iteration

- Lighter touch — only intervene at session boundaries, not every event
- Replace control tokens with slash commands (`/focus:start`, `/focus:done`)
- Strip Xero-specific logic — make mission suggestions pluggable
- Consider making it a skill instead of a hook — less intrusive, user-initiated
- Keep momentum/XP concept but make it opt-in per session
- Integrate with TASKS.md instead of its own state file
