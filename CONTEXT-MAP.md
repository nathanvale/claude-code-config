# Context Map

This repo has multiple bounded contexts. Each owns the durable language for its area. Resolve a term in the nearest scoped context first; fall back to the root context for cross-cutting agent-config, startup, governance, and CLI-design vocabulary.

## Contexts

- [Root — Claude Code Config](./CONTEXT.md) — cross-cutting agent-config, startup, governance, and CLI-design vocabulary only.
- [Browser Use](./skills/browser-use/CONTEXT.md) — Warm Chrome, Browser Adapters, the Router, durable browser knowledge, playback modes.
- [One Password](./skills/one-password/CONTEXT.md) — safe `op` secret access: service-account paths, secret reference mappings, materialized adapters.
- [Prompt System Workflow](./skills/prompt-system-workflow/CONTEXT.md) — startup-instruction authoring shape, topology helper, setup CLI, install artifacts.
- [Issue to PR](./runbooks/issue-to-pr-v2/CONTEXT.md) — helper contract, ledger lifecycle, workflow-learning scan, scaffold pointers.
- [Create Skill](./skills/create-skill/CONTEXT.md) — portable skill authoring, cleanup, capability ownership, agent-native helper handoff.
- [Storybook](./skills/storybook/CONTEXT.md) — Storybook MCP workflows, readiness proof, previews, tests, and taxonomy language.
- [ADHD Helper](./skills/adhd-helper/CONTEXT.md) — ADHD-shaped executive-function support language for moments and support cards.
- [Skill Self-Audit Loop](./skills/skill-self-audit-loop/CONTEXT.md) — proof methods, trust conditions, contradiction shapes for self-auditing a SKILL.md.
- [Skill Feedback](./skills/skill-feedback/CONTEXT.md) — skill-observability capture loop: Receipt, CaptureAdapter, Software Learning Report, the gitignored inbox.
- [worktree](./skills/worktree/CONTEXT.md) — workflow entry point for worktree-aware VS Code workspace rendering and its boundary with shared git/worktree runtime ownership.

## Relationships

- **Browser Use → One Password**: an Auth Pointer is browser-owned; `one-password` only resolves it at runtime, never owns it.
- **Issue to PR → Root**: `Implementation slice` is a shared term kept at root; the runbook context reuses it without redefining.
- **Create Skill → all skill contexts**: owns the reusable authoring vocabulary the others build on; domain-specific skills keep their own nearest `CONTEXT.md`.
- **Storybook → Root**: reuses root CLI Front Door language for Storybook Doctor while keeping Storybook readiness and MCP vocabulary local.
- **Skill Feedback → Create Skill**: a Software Learning Report is evidence that may drive an edit to a `SKILL.md`, governed by Create Skill's authoring language.
- **Skill Feedback → Root**: reuses the root's facade, redaction-owner, and storage-routing vocabulary; the inbox storage rule is owned by `skills/context-advisor/references/storage-routing.md`.
- **Skill Self-Audit Loop ↔ Skill Feedback**: both treat record/loop-file text as untrusted evidence, never canonical instruction.
- **worktree → Root**: reuses root CLI Front Door language but reserves Workflow Entry Point for the skill-level route.
