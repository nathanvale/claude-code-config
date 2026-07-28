# Browser Use Security Architecture

Package architecture for `@side-quest/browser-use-security`.

## Shape

`browser-use-security` is the native product owner chartered by ADR 0027:
Browser Use Security ships as one signed, notarized macOS product containing
three separately signed executable targets — Approval Broker, Token Retrieval
Launcher, and Confidential Field Delivery XPC. This package owns the code-side
model of that product: per-target identity, the code-owned admission manifest,
and the drift proof. It mints no Swift, signs nothing, and holds no secret
bytes.

ADR 0028 splits the pure contract (in `skills/browser-use/src/`) from this
signed native capability. Absence of the native product is a legal, tested
state — `native-capability-absent` — expressed through typed verdicts, never a
crash or a stub. A later unit mints the literal `com.*` bundle strings; the
placeholder sentinel in `src/model.ts` keeps admission fail-closed until then.

The Module Map below is the single per-module owner list. `AGENTS.md` and
`README.md` point here instead of repeating it; `tests/docs-drift.test.ts`
keeps the map complete in both directions.

## Maintainer Surfaces

- `AGENTS.md`: maintainer route, intent gate, change recipes, doc drift gate.
- `README.md`: human front door and product overview.
- `CONTEXT.md`: package language for target, admission, and capability posture.
- `tests/docs-drift.test.ts`: Module Map drift gate plus maintainer doc-set
  presence check.

## Module Map

- `package.json`: exports (`.` and `./cli`), `test` and `typecheck` scripts.
  No `bin` and no `sideQuest.sourceLinkedBin` yet — a later unit mints the CLI
  front door via `cli-author`.
- `src/model.ts`: the three target ids, the branded `BundleId` type with its
  `PLACEHOLDER` sentinel and admission guard (`isMintedBundleId`), per-target
  placeholder bundle ids, the admission-manifest schema types with per-target
  entitlements summary, lifetime, and custody (`TargetEntitlementsSummary`,
  `TargetLifetime`, `TargetCustody`, `TargetAdmissionEntry`,
  `AdmissionManifest`), and the closed `AdmissionVerdict` union including
  `native-capability-absent`.
- `src/admission.ts`: the code-owned admission manifest
  (`CODE_OWNED_ADMISSION_MANIFEST`), the ADR-0027 custody baseline, the
  compile-time-exhaustive `AdmissionErrorCode` union with its
  `satisfies Record<…>` reason map (`ADMISSION_ERROR_CODES`), per-target
  verification (`admitTarget`), and the minted-manifest builder
  (`buildAdmittedManifest`). Any drift — replaced, resigned, removed,
  entitlement-widened, or version-skewed target — fails closed with a typed code.
- `src/runtime.ts`: the injectable admission-runtime seam (`AdmissionRuntime`).
  `createNativeAbsentRuntime` is the prod placeholder returning the typed
  `native-capability-absent` verdict until the signed product exists;
  `createInMemoryAdmissionRuntime` is the earned in-memory fake that matches the
  prod output shape exactly (compact/pretty JSON parity).
- `src/cli.ts`: the `./cli` subpath export. Owns the in-process
  `main(argv, deps)` consumption seam that drives the injected admission runtime
  (`verify` command + bare posture), plus the fail-closed
  `native-capability-absent` scalar posture (`cliPlaceholderVerdict`). A later
  unit replaces the surface with the facade-backed command CLI.
- `src/index.ts`: re-exports the package seam (`src/admission.ts`, `src/cli.ts`,
  `src/model.ts`, `src/runtime.ts`).
- `tests/docs-drift.test.ts`: proves `src` modules and this Module Map agree in
  both directions and the maintainer doc set is complete.
- `tests/admission.test.ts`: proves manifest drift (replace/resign/remove/widen/
  version-skew/stale/placeholder) invalidates admission with the right code.
- `tests/runtime.test.ts`: proves the prod and in-memory adapters share the
  `native-capability-absent` output shape byte-for-byte and drive `main`.

## Boundaries

- No `SecurityPolicy` registry: the three targets are a closed, fixed set
  (ADR 0027). There is no external extension boundary; a fourth target requires
  a new decision, not a registry entry.
- No secret bytes cross TypeScript, argv, env, output, adapter, daemon, or
  durable state. This package models identity and admission evidence only.
- Every admission path is fail-closed: a placeholder bundle id is never
  admitted, and an absent native product yields `native-capability-absent`.
