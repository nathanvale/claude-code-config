---
status: accepted
date: 2026-06-02
supersedes: 0008-browser-use-owns-warm-chrome-binding-lifecycle.md
---

# browser-use Uses Fixed CDP Convention And Runtime Proof

`browser-use` uses the current Warm Chrome convention: CDP on `9222`, dedicated profile at `~/.agent-warm-profile`, and proof on every run.

## Decision

- Use Warm Chrome Preflight as browser-entry authority.
- Use Browser Adapter Proof as second-stage adapter authority.
- Keep `--port` and `--endpoint` as current-run inputs only.
- Do not write or read durable Warm Chrome Binding state.
- Do not add leases, allocator ranges, mutation locks, or ownership records.
- Treat `DevToolsActivePort` as adapter hint material, not lifecycle state.
- Fail with diagnostics when an adapter points at stale config.
- Forbid adapter or cold-browser fallback after proof failure.

## Consequences

- Fresh agents prove reality instead of trusting persisted ownership.
- Stale adapter bindings surface before browser action.
- Multi-profile fleets need a separate decision.
- Durable browser knowledge consumes proof output; it does not own readiness policy.

## Amendment 2026-07-03

- When `9222` is occupied by a non-Warm-Chrome listener, failure diagnostics
  may include an informational `suggested_explicit_port` from a loopback scan.
- The suggestion is a repair hint, not an allocator: no launch, no
  persistence, no rebinding on the suggested port. It is never authoritative —
  never persisted, never read back, never reused as allocator state.
- The candidate comes from a bounded loopback scan window (a small
  unprivileged range near `9222`, never below `1024`); the scan must not be
  widened to arbitrary ports.
- A suggested port becomes usable only after an explicit rerun with
  `--port`/`--endpoint` and a successful Warm Chrome proof.
- Detail: `docs/decisions/2026-07-03-warm-chrome-runtime-package-definition.md`.
