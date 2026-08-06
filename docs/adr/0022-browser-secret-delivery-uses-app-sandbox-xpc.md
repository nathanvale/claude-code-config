---
status: accepted
date: 2026-07-22
---

# Browser secret delivery uses App Sandbox XPC

The Confidential Field Delivery Helper is a signed disposable macOS XPC service under App Sandbox. It has no outgoing or incoming network entitlement and no broad file entitlement. It receives only a private secret-pipe descriptor and a pre-opened verified browser-channel descriptor through supported XPC file-descriptor APIs, performs one bounded field action, then exits.

The official `op` process remains the short-lived networked retrieval member of the trusted computing base. It receives the exact token, vault, item, and field but no verified browser endpoint or channel. Browser Use makes no unsupported claim that basic App Sandbox restricts it to 1Password domains.

## Considered Options

- Build 1Password-domain-only retrieval confinement: stronger blast-radius control, but requires a substantially larger native network-security subsystem beyond App Sandbox's coarse outgoing-network entitlement.
- Disable unattended authentication: remains the fallback whenever delivery containment or inherited-descriptor use fails proof.

## Consequences

- Runtime verifies delivery-helper signature and entitlements before every capability proof.
- A live probe must prove transferred secret-pipe and connected-browser descriptors work without allowing new connections or unrelated file access.
- `sandbox-exec` and private sandbox profiles are not architecture dependencies.
- Retrieval-helper trust is explicit and reviewable rather than hidden behind a false domain-confinement claim.
