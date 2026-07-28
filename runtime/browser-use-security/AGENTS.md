# Browser Use Security Agent Guide

`@side-quest/browser-use-security` is the native product owner for Browser Use
Security (ADR 0027): one signed macOS product, three separately signed
targets — Approval Broker, Token Retrieval Launcher, Confidential Field
Delivery XPC. This package owns the code-side model — per-target identity, the
admission manifest, and the drift proof — and hosts the unsigned native target
sources (`targets/`, `BrowserUseSecurity.xcodeproj/`, `entitlements/`) under
this owner directory per ADR 0027/0028. Secret bytes never transit this
package's TypeScript layer; token bytes are handled only inside the signed Token
Retrieval Launcher, which hands them to the disposable `op` child. Signing and
notarization stay operator-gated (ADR 0028 entry gate).

This file routes maintainers. `README.md` explains the product to humans.
`CONTEXT.md` owns package language.

## Always Read

Read `CONTEXT.md` first. It defines target, admission manifest, bundle-id
placeholder, and capability-absent posture. Then read only the file the Intent
Gate routes to.

## Intent Gate

- **Understand the product** -> `README.md`, then ADR 0027 and ADR 0028.
- **Explain package language** -> `CONTEXT.md`.
- **Change target ids, bundle-id placeholders, admission-manifest schema, or
  the admission verdict union** -> `ARCHITECTURE.md` Module Map and
  `src/model.ts`.
- **Change the minted `com.side-quest.*` bundle strings** -> edit `src/model.ts`
  `TARGET_BUNDLE_IDS`/`PRODUCT_BUNDLE_PREFIX` and mirror the Xcode targets'
  `PRODUCT_BUNDLE_IDENTIFIER` + each `Info.plist` `CFBundleIdentifier`; keep
  `isMintedBundleId` rejecting `BUNDLE_ID_PLACEHOLDER` so the code-owned manifest
  stays fail-closed.
- **Mint the CLI front door** -> `cli-author`, then add `bin` and
  `sideQuest.sourceLinkedBin` to `package.json` and replace `src/cli.ts`.
- **Change source-owner layout** -> `ARCHITECTURE.md` Module Map, then run the
  Doc Drift Gate.

## Change Recipes

- **New target-model field:** update `src/model.ts` (type + JSDoc), then this
  package's tests before any runtime consumes it.
- **Bundle-id minting:** replace the `BUNDLE_ID_PLACEHOLDER` entries with real
  `com.*` strings via `mintedBundleId`; prove `isMintedBundleId` still rejects
  any target left unminted.
- **Admission-manifest schema change:** bump `ADMISSION_MANIFEST_SCHEMA_VERSION`
  and pin a fixture before the runtime emits or admits the new shape.
- **Source owner split or move:** update `ARCHITECTURE.md` Module Map and run
  the Doc Drift Gate.

## Doc Drift Gate

Run after source-owner moves or Module Map changes.

```bash
skills/test-runner/src/test-runner.sh run -- runtime/browser-use-security/tests/docs-drift.test.ts
```

The docs-drift test proves `src` modules and the `ARCHITECTURE.md` Module Map
agree in both directions, and that the maintainer doc set is present.

## Safety Invariants

- No `SecurityPolicy` registry: the three targets are closed and fixed by
  ADR 0027; a fourth target requires a new decision.
- No secret bytes through TypeScript, argv, env, output, adapter, daemon, or
  durable state.
- A placeholder bundle id is never admitted; `isMintedBundleId` gates admission.
- `native-capability-absent` is a legal typed state; every absent path stays
  fail-closed and never crashes.
- Packaging never unions privilege or secret custody across targets (ADR 0027).

## Verification

```bash
skills/test-runner/src/test-runner.sh run -- runtime/browser-use-security/tests/
bun --filter @side-quest/browser-use-security typecheck
```
