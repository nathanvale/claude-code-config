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
