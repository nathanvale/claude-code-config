---
name: browser-domain-memory
description: "Plan or build durable browser-domain-memory. Use for browser memory, Browser Runbooks, browser replay modes, domain-specific browser capture, or saved browser workflow storage. Not for general context routing."
role: main-entry
---

# Browser Domain Memory

Canonical home for durable per-domain browser knowledge.

## Status

- Planned capability; runtime implementation pending.
- Active plan: `docs/plans/2026-05-31-001-feat-browser-domain-memory-plan.md`.
- Only the prerequisite gate has landed under `skills/browser-domain-memory/scripts/`.
- No durable reads, writes, replay, config, locks, auth, gates, or promotion routes are available yet.
- Do not treat this stub as runtime proof.

## Start Work

- Run the prerequisite gate first: `skills/browser-domain-memory/scripts/browser-domain-memory-prerequisites.sh --json`.
- Stop if it exits non-zero. The result names the missing prototype source, replay dependency, or facade link and the repair action. Do not start runtime units on a red gate.
- The gate owns the prototype/dependency inventory (`prerequisites.ts`). Do not re-list those paths in prose.
- Read the active plan, then start the first vertical slice: U0, U0a, U0b, U0c, U1, U1a.
- Run `cli-author` before authoring CLI contracts.
- Build code under `skills/browser-domain-memory/scripts/`.
- Mirror `skills/browser-use/scripts/` for facade CLI topology.
- Use `browser-use` Warm Chrome Preflight for browser entry.
- Do not duplicate Warm Chrome readiness policy.

## Planned Surface

- Durable store: Auth Pointers, Browser Runbooks, Recorder JSON, Browser Gotchas, Run Outcomes, selective Scratch Evidence.
- Playback modes: `prose`, `runbook`, `deterministic`; `auto` resolves to `prose` in v1.
- First CLI routes: `read`, `status`, `config:get`, `config:explain`, `config:set`.
- Later CLI routes: `capture`, replay, promotion, saved workflow surfaces per active plan.
- Safety: no secret values on disk; auth/config/mode writes need human approval.

## Runtime Requests

- Current browser work: use `browser-use`.
- Current save/reuse requests: say browser-domain-memory is planned, then ask whether to capture implementation notes or continue with live `browser-use`.
