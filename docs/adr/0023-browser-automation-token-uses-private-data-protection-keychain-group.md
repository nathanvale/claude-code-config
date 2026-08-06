---
status: accepted
date: 2026-07-22
---

# Browser Automation token uses a private data-protection Keychain group

The Browser Automation service-account token is stored as a non-synchronizing `AfterFirstUnlockThisDeviceOnly` item in the macOS data-protection Keychain. A private keychain access group, authorized through the signed retrieval launcher's entitlements and provisioning profile, is the only code path allowed to read it.

The launcher reads the item without Touch ID and immediately `exec`s the disposable official `op` helper with an exact environment. Normal retrieval after login is prompt-free. Touch ID remains reserved for human action approval.

This is safer than a plaintext token file, but it does not turn the service-account token into a non-exportable key. Keychain encrypts it at rest, prevents ordinary same-user processes without the access-group entitlement from retrieving it, and keeps it off synchronization and broad environment-loading paths. During use, the signed launcher and official `op` process still receive bearer bytes; compromise of that trusted retrieval process can copy the token. The token's one-vault read-only scope remains the final damage boundary.

## Human Friction

- One no-echo enrollment per device.
- Re-enrollment after service-account token rotation.
- Repair after Keychain reset, device replacement, or signing/access-group identity drift.
- Typed failure before the user's first unlock after boot; no background prompt or ambient-env fallback.

## Considered Options

- Existing `with-env`: sources every value from `.env.1password`, widening the retrieval process's secret exposure.
- Ambient `OP_SERVICE_ACCOUNT_TOKEN`: exposes the token to Browser Use, tmux, shells, and unrelated children.
- Touch ID on every read: strong user presence but defeats unattended browser authentication and duplicates the separate approval boundary.

## Consequences

- The native launcher needs stable team, bundle, provisioning, and access-group identity.
- The token does not synchronize to another device.
- Legacy `SecTrustedApplication` and file-keychain ACL APIs are not used.
- Missing bootstrap state returns an enrollment/repair continuation rather than requesting interactive 1Password access inside an unattended run.
