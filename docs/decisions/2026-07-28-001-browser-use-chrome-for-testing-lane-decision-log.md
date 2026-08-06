---
title: Browser Use Chrome for Testing Lane Decision Log
slug: browser-use-chrome-for-testing-lane
type: decision-log
status: complete
date: "2026-07-28"
timezone: Australia/Melbourne
owner: runtime/warm-chrome
source:
  - skills/browser-use/docs/research/2026-07-28-chrome-for-testing-browser-use-tradeoffs.md
  - "2026-07-28 Decision Mode: explicit proven Chrome for Testing lane"
decision_metadata_format: fenced-yaml-per-decision
---

# Browser Use Chrome for Testing Lane Decision Log

## Frame

Decide whether Browser Use should permanently ban Chrome for Testing or admit
it through a bounded browser-entry contract.

## Notes

- Runtime behavior remains unchanged until the explicit lane is implemented and
  verified.
- Chrome for Testing remains forbidden as an automatic or silent fallback.

## Decision 1: Admit Chrome for Testing only through an explicit proven lane

```yaml
id: browser-use-chrome-for-testing-lane-001
status: accepted
decided_at: "2026-07-28"
decision: Replace the permanent Chrome for Testing ban with an explicit capability-proven lane while retaining the current rejection until that lane passes acceptance.
owner: runtime/warm-chrome
scope: browser eligibility and entry proof
source:
  - skills/browser-use/docs/research/2026-07-28-chrome-for-testing-browser-use-tradeoffs.md
  - "2026-07-28 Decision Mode: option 2 accepted by Nathan"
decision_mode:
  question: Should Browser Use keep a blanket Chrome for Testing ban?
  option: Explicit proven Chrome for Testing lane
  confidence: strong
```

Decision:

- Treat the existing Chrome-for-Testing rejection as a temporary implementation
  guard, not a permanent product rule.
- Admit Chrome for Testing only through an explicit browser class that satisfies
  the Warm Chrome capability and proof contract.
- Never use Chrome for Testing as an automatic fallback after browser-entry
  failure.

Rationale:

- Reviewed official evidence does not show that Chrome for Testing cannot
  authenticate or reuse a custom profile.
- Browser safety depends more directly on headed mode, profile persistence and
  ownership, loopback CDP, browser identity, endpoint proof, and controlled
  lifecycle than on the binary product name alone.
- An explicit lane preserves fail-closed behavior while enabling deterministic,
  version-pinned automation.

Consequences:

- Current Browser Use and Warm Chrome behavior does not change until a tested
  implementation lands.
- The future lane requires a headed browser, dedicated persistent owner-only
  profile, numeric-loopback CDP, verified binary/profile/listener/endpoint
  consistency, an exact CfT version, and an explicit upgrade policy.
- Acceptance requires representative authentication-continuity proof and
  profile/extension migration proof across supported version changes.
- Google Chrome remains the default browser class.
- Generic, cold, throwaway, or implicit CfT launches remain unsupported.

Next:

- Plan the smallest contract and runtime slice for an explicit browser-class
  input and capability proof.
- Keep the current rejection until the new lane's tests and live acceptance
  evidence pass.

V2 Ideas:

- Evaluate whether the two browser classes need separate upgrade cadences.
- Add a human-readable browser-class status surface after the runtime contract
  exists.

