---
status: accepted
---

# Plan/apply lifecycle: disposable plan artifact in XDG state

`plan` and `apply` are separate steps (R8: explicit execute after preview). The
plan a `plan add`/`plan remove` produces is written to a disposable artifact so
an agent can inspect it, then `apply` it in a later non-interactive call.

The plan artifact is **mutable operational state**, not durable truth and not a
repo file. It lives under `$XDG_STATE_HOME`
(`~/.local/state/skillporter/plans/<id>.json`, dir `0700` / file `0600`). It is
disposable: the refresh path is re-running `plan`, and a stale plan cannot cause
harm because `apply` re-validates the ownership and lock-reconciliation gates
against live state before mutating.

## Why XDG state, not the repo

The context-advisor storage-routing map classifies a rebuildable checkpoint
between two commands as operational state → `$XDG_STATE_HOME`. A repo-local
`.skillporter/plans/` directory was the initial instinct and is explicitly
wrong: runtime checkpoints are not repo artifacts and must not be committed or
clutter a checkout.

## Considered options

- Same-run only (no artifact; `plan` + `apply` in one invocation) — rejected for
  V1: breaks the agent inspect-then-apply flow across two non-interactive calls
  (actor A2).
- Repo-local plan file (`.skillporter/plans/` in cwd) — rejected: storage-routing
  says runtime state does not belong in the repo.
- Persist plans in the durable ledger store (`$XDG_DATA_HOME`) — rejected: plans
  are disposable, not canonical; mixing them with durable ownership truth blurs
  retention and recovery.

## Consequences

- `apply` consumes a plan id/file but treats the plan as a *proposal*: it
  re-runs the gates, so a plan that was valid at preview but is now blocked fails
  closed at apply (ties to ADR-0018's apply-on-blocked = error).
- Plan id/format and the read/validate path are code-owned in
  `runtime/skill-porter/`; this ADR names the storage tier and lifecycle, not the
  schema.
