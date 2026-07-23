---
status: accepted
date: 2026-07-22
---

# Browser Use local broker is the human approval authority

Browser Use owns one local approval broker. A device-bound non-exportable private key requires Touch ID-backed user presence when creating, expanding, replacing, or revoking signed authorization. Verifiers pin the broker's public key identity. Authorization may be a purpose-bound expiring one-use grant or a bounded standing policy for future matching runs.

The broker owns key creation, issue, public verifier identity, consumption, rotation, revocation, invalidation, and recovery. Rotation or recovery changes the verifier identity and revokes every outstanding authorization. Matching routine runs verify standing policy without Touch ID. Missing biometric capability, cancelled presence, unavailable broker, or headless execution blocks only creation, expansion, or replacement of authorization; no unsigned fallback exists.

## Considered Options

- Make 1Password the approval authority: conflates secret retrieval with action authorization and lacks the required purpose-bound signing contract.
- Accept terminal confirmation: mutable process state can be fabricated or replayed by the requesting agent.

## Consequences

- Agents may prepare approval requests but cannot mint grants.
- YAML, JSON, and cache edits cannot authorize access or mutation.
- Agents may evaluate and consume an existing standing authorization but cannot expand its scope.
- Approval remains local to the enrolled device unless a future decision defines a separate remote authority.
- Device-key loss requires user-present recovery and invalidates outstanding approvals.
