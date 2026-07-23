---
status: accepted
date: 2026-07-23
---

# Human Identity Attestation is one-run only

Some portals expose no stable Session Identity Proof and may leave weak page evidence missing, conflicting, or non-unique. Browser Use may then request a Touch ID-backed Human Identity Attestation for the exact current run, browser handoff, lane, profile, origin, target, claimed subject/account/tenant, mutation target and scope, action policy, and freshness window. Atomic consumption permits one mutation run.

The attestation is an explicit human identity claim, not Session Identity Proof and not standing authorization. It cannot survive target or claim drift, authorize a later run, override a stable machine-readable identity mismatch or proven wrong account, or compensate for unproven mutation-target ownership.

## Considered Options

- Require repaired machine proof for every mutation: strongest assurance but leaves opaque portals permanently unsupported.
- Permit a standing identity exception: preserves autonomy but creates a reusable wrong-account bypass.

## Consequences

- Opaque portals retain a bounded human-assisted path.
- Routine proven sessions remain autonomous and prompt-free.
- The local approval broker must support one-run identity claims and atomic consumption.
- Auth outcomes name exactly one identity basis: Session Identity Proof or Human Identity Attestation.
