---
name: browser-domain-memory
description: "Plan or build durable browser-domain-memory. Triggers on browser memory, Browser Runbooks, replay modes, or capture."
---

# Browser Domain Memory

Canonical home for durable per-domain browser knowledge.

## Status

- Planned capability; runtime implementation pending.
- Active plan: `docs/plans/2026-05-31-001-feat-browser-domain-memory-plan.md`.
- No `skills/browser-domain-memory/scripts/` CLI has landed.
- No durable reads, writes, replay, config, locks, auth, gates, or promotion routes are available yet.
- Do not treat this stub as runtime proof.

## Start Work

- Read the active plan first.
- Start with first vertical slice: U0, U0a, U0b, U0c, U1, U1a.
- Restore prototype sources or record a concrete immutable artifact path before lifting code.
- Run `create-cli` before authoring CLI contracts.
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
