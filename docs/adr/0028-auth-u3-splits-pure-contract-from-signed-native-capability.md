---
status: accepted
date: 2026-07-26
---

# Auth U3 splits the pure contract from the signed native capability

Auth U3 delivers in two halves. U3a is pure TypeScript in `skills/browser-use/src/`: token-scoped vault validation, deterministic item binding, the candidate-import Interface, attestation persistence, and the approval/provider modules written against injected Ports (`ApprovalBrokerPort`, `TokenRetrievalPort`). U3b is the `runtime/browser-use-security/` native product chartered by ADR 0027. U3a merges and ships without U3b; absence of native capability is a legal, tested state expressed through the existing typed bootstrap/repair continuations (`enroll-browser-automation-token` and peers), never a crash or a stub.

U3b's entry gate is paid Apple Developer Program enrollment plus full Xcode. The free personal team is rejected because its provisioning profiles expire on a roughly weekly cycle, and any verifier identity rotation revokes every outstanding standing authorization; a security product whose identity churns weekly destroys the standing-authorization model it exists to provide. Ad hoc signing is already falsified by the U0 evidence receipt (`upstream-change-required`): embedded XPC lookup failed, and the data-protection Keychain access group for the token item is a restricted entitlement requiring a provisioning profile embedded in an app-like bundle, which no bare CLI or Developer-ID-cert-only binary can hold.

## Pressure Gate

- Pressure source: every U3 vault/binding/approval behavior needs tests now, while the machine has zero signing identities and the R7 Keychain item and R20 device key cannot exist.
- Seam: the two Ports; U2 already proved the idiom with `attestationByDigest` injection, and the transaction's lease/blocked event vocabulary already types every native failure.
- Deletion test: deleting the split blocks all of R8-R13/AE2-AE3 and the Platform U3 candidate-import consumer on a purchase decision; deleting the enrollment gate re-runs the falsified ad hoc path.
- Locality: native lifecycle stays whole in `runtime/browser-use-security/` (ADR 0027); contract logic stays whole in `skills/browser-use/src/`.
- Leverage: U3a unblocks Platform U3 migration and the R27 CLI surface immediately; enrollment later unblocks U3b, the U0 XPC re-run, notarization, and the U5-U7 delivery lane at once.

## Considered Options

- Acquire signing capability first, build U3 whole: grounds Port shapes in real native semantics but blocks all contract work, and the Platform U3 consumer, on enrollment and a multi-gigabyte Xcode install.
- Build the native half under ad hoc signing: falsified by the U0 receipt and TN3137's restricted-entitlement rules.
- Free personal team: rejected above; weekly identity churn is structurally incompatible with R20 standing authorization.
- Hybrid: ship the Approval Broker early on entitlement-free file-persisted Secure Enclave keys (CryptoKit `dataRepresentation`, proven by age-plugin-se) under minimal signing. Rejected as plan structure because it forks U3b into two signing postures with unverified ad hoc identity stability; retained as a candidate broker design to evaluate inside U3b.

## Consequences

- Port shapes may drift from real native semantics until U3b validates them; U3b's first milestone re-proves the Ports against the signed targets.
- "Enroll in the paid Apple Developer Program and install full Xcode" is recorded on the U3b tracker task as its entry dependency; U3a's task carries no such dependency.
- The Token Retrieval Launcher must be an app-like bundle embedding a provisioning profile (daemon-in-app's-clothing), not a bare binary; the U3b scaffold starts from that shape.
- The file-persisted Secure Enclave key remains a live design option for the Approval Broker inside U3b, evaluated after enrollment when both postures are testable.
