---
status: accepted
date: 2026-06-03
---

# Router Research Recovery Uses Diagnostic Trail

Browser Adapter Router research recovery metadata lives in Router-owned diagnostic detail surfaced by the facade `diagnostic_trail` pointer. The facade envelope names the continuation action and same-run diagnostic target; Router owns bounded research fields such as query, sources, last checked, stale reason, retry posture, terminal condition, and advisory research signal.

## Considered Options

- Facade-level recovery payload: stronger shared typing, but widens the shared schema for Router-specific research semantics.
- Action id and terse hint only: smaller surface, but loses typed, inspectable recovery detail.
- Router diagnostic detail through `diagnostic_trail`: keeps the facade envelope narrow while preserving typed package-owned recovery detail.

## Consequences

- `continuation.next_action_id` names `research_adapter_capability`.
- `diagnostic_trail` points to the Router diagnostic surface for bounded research detail.
- `hint` stays terse and does not carry structured research fields.
- `research_signal` stays advisory diagnostic metadata, not route confidence.
- Route Validity applies only to selected routes or failed route evaluations, not report discovery or invalid route input.
