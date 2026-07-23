---
status: accepted
date: 2026-07-23
---

# Browser Use is schedulable, not a scheduler

Browser Use release one exposes one agent-neutral CLI and JSON contract. Claude Code, Codex, human shells, `launchd`, Codex Automations, and future external schedulers call the same command and receive the same parser, policy, run-state, continuation, result, and repair semantics.

Caller metadata exists for audit only. It never grants capability or authority. Browser Use depends on no Claude Code or Codex private API.

Browser Use owns safe execution, standing-authorization evaluation, idempotency, duplicate-action protection, restartable runs, and unknown-effect handling. It does not own clocks, calendars, wake/login behavior, missed-trigger policy, or a long-lived scheduling daemon in release one. Scheduled runs may proceed while the enrolled user session and required runtime capabilities are available.

## Considered Options

- Build scheduling into Browser Use: centralizes triggering but adds calendar, sleep, login, overlap, missed-run, and notification policy to an already deep runtime.
- Support Codex-specific automation: faster for one caller but breaks Claude Code parity and makes private integration product authority.
- Support Claude Code and Codex through separate wrappers: duplicates semantics and creates drift.

## Consequences

- Claude Code and Codex receive equal first-release support.
- External scheduling works without making Browser Use a scheduling platform.
- CLI discovery, help, parser, JSON schema, policy, runtime behavior, and repair remain one mechanically checked contract.
- Caller-specific convenience wrappers may exist only as thin projections over the public contract.
- A future internal scheduler requires a separate decision.
