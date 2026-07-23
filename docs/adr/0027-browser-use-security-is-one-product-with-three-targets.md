---
status: accepted
date: 2026-07-23
---

# Browser Use Security is one product with three executable targets

Browser Use Security ships as one signed and notarized macOS product containing three separately signed executable targets: Approval Broker, Token Retrieval Launcher, and Confidential Field Delivery XPC. One product owner controls stable signing identity, provisioning, bundle identities, notarization, installation, compatible upgrade, admission, versioning, and repair.

Each target retains its own bundle identity, entitlements, process lifetime, admission evidence, and runtime verification. Packaging never unions privilege or secret custody: the broker receives no OP token or raw credential, the retrieval launcher receives no browser channel, and the delivery target receives no OP token or network entitlement. Targets run on demand; no LaunchAgent or daemon is introduced.

## Pressure Gate

- Pressure source: signing, provisioning, notarization, installation, upgrade, admission, and repair span all three targets.
- Seam: one Browser Use Security product Interface with three internal executable-target seams.
- Deletion test: deleting the product owner spreads lifecycle complexity across three packages; collapsing the targets unions incompatible privileges.
- Locality: native lifecycle and compatibility remain in one Module.
- Leverage: Browser Use admits one product version while verifying every target independently.

## Considered Options

- Three independently owned products: preserves process isolation but duplicates lifecycle Interfaces without a second consumer or release cadence.
- One product and one executable process: simplifies packaging but violates the accepted raw-secret trusted computing base by combining approval, token, network, and browser authority.

## Consequences

- A new `runtime/browser-use-security/` owner is required.
- The native product needs a code-owned admission manifest and drift tests.
- Installation orchestration may call the product Interface but cannot own signing or target policy.
- Adding another daemon, LaunchAgent, product, or shared entitlement requires a separate decision.
