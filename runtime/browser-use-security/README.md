# browser-use-security

`browser-use-security` is the native product owner for Browser Use Security:
one signed, notarized macOS product containing three separately signed
executable targets (ADR 0027). It owns the code-side model of that product —
per-target identity, a code-owned admission manifest, and drift proof — so
Browser Use can admit one product version while verifying every target
independently.

The `src/` model is pure TypeScript: it signs nothing and holds no secret
bytes. The unsigned native target sources (`BrowserUseSecurity.xcodeproj/`,
`targets/`, `entitlements/`) are authored alongside it; they carry no secret
bytes and do not build without full Xcode plus paid Apple Developer Program
enrollment (ADR 0028 entry gate).

## The Three Targets

| Target | Role | Never receives |
| --- | --- | --- |
| Approval Broker | Touch ID-backed presence | OP token, raw credential, browser channel |
| Token Retrieval Launcher | App-like bundle embedding a provisioning profile | browser channel |
| Confidential Field Delivery XPC | Delivers confidential fields | OP token, network entitlement |

Packaging never unions privilege or secret custody across targets.

## Capability Posture

ADR 0028 splits the pure contract (`skills/browser-use/src/`) from this signed
native capability. The native product may be entirely absent — that is a legal,
tested state, `native-capability-absent`, expressed through typed verdicts, not
a crash or a stub.

Production promotion is unavailable. The unsigned sources and hermetic tests do
not install or admit a signed product and make no production Touch ID or
Developer ID acceptance claim. Route signed-product installation, admission,
presence-backed acceptance, and repair to a separate reviewed plan.

Bundle ids are minted: `src/model.ts` `TARGET_BUNDLE_IDS` carries the real
`com.side-quest.browser-use-security.*` strings, mirroring each Xcode target's
`PRODUCT_BUNDLE_IDENTIFIER` and `Info.plist` `CFBundleIdentifier`. The
code-owned admission manifest still ships the `BUNDLE_ID_PLACEHOLDER` sentinel,
so admission stays fail-closed until a signed install presents a minted claim.

## Files

Per-module owners live in [ARCHITECTURE.md](./ARCHITECTURE.md) Module Map.
Package docs: [AGENTS.md](./AGENTS.md) maintenance routing,
[CONTEXT.md](./CONTEXT.md) vocabulary.

## Authority

- Product charter: `docs/adr/0027-browser-use-security-is-one-product-with-three-targets.md`
- Contract/capability split: `docs/adr/0028-auth-u3-splits-pure-contract-from-signed-native-capability.md`
- Pure contract half: `skills/browser-use/src/`

## Develop

Run package tests:

```bash
skills/test-runner/src/test-runner.sh run -- runtime/browser-use-security/tests/
```

Run typecheck:

```bash
bun --filter @side-quest/browser-use-security typecheck
```
