---
status: accepted
date: 2026-07-22
---

# Autonomous runs use bounded standing authorization

Browser Use requests Touch ID when a human creates, expands, replaces, or revokes authorization, not whenever browser automation runs. A signed standing authorization permits future matching runs to proceed without biometric prompts.

The policy binds service/workflow, subject/account/tenant, environment/profile, allowed origins, runbook and action-policy hashes, allowed mutation classes, human-confirmed hard limits, and duplicate-action key policy. Validated runbook declarations and observed portal constraints may propose limit values with provenance, but proposals have no authority. The human confirms the exact values once; the broker signs those values as the hard boundary. The policy has no calendar expiry. It remains valid until explicit revocation or atomic invalidation after runtime observes drift in a bound fact. An invalidated policy id never becomes valid again if facts later revert. Each run records the policy digest and mechanical evaluation evidence. Runtime evaluation may narrow or reject authorization but never expand it.

Observed drift in service/workflow, account/tenant, environment/profile, allowed origins, runbook/action-policy hash, or mutation class atomically invalidates the policy. Exceeded limits, ambiguous identity, unknown external effect, duplicate risk, or new scope pauses the affected run without widening the policy. An annual review reminder is advisory and never changes validity. Passkeys, security keys, CAPTCHA, and equivalent site challenges remain unavoidable user-presence steps.

## Considered Options

- Touch ID for every final submission: safe but incompatible with an autonomous driver.
- Let runbooks or portals define limits automatically: convenient but turns mutable evidence into authorization.
- Omit numeric limits: autonomous but too broad for variable-value mutations.
- No authorization boundary: maximally autonomous but permits silent scope growth and unsafe new mutations.

## Consequences

- Routine matching authentication, runbook execution, save-draft, and explicitly authorized submission require no Touch ID.
- Limit proposals expose their provenance. Only exact human-confirmed values enter the signed policy.
- One-use signed grants remain available for exceptional choices such as ambiguous credential binding.
- The platform needs deterministic policy evaluation, duplicate-action reservation, revocation, permanent drift invalidation, and evidence that fact reversion cannot revive an invalidated policy id.
- Headless runs may use an already-valid standing authorization but cannot create or widen one.
- Annual review reminders are non-blocking. One-use grants, auth attestations, leases, and capabilities retain their own freshness or expiry rules.
