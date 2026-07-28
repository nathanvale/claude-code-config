# Browser Use Security

Native product owner for Browser Use Security: one signed macOS product, three
separately signed executable targets (ADR 0027). This package owns the
code-side model in pure TypeScript — identity, admission manifest, and drift
proof — and hosts the unsigned native target sources (`targets/`,
`BrowserUseSecurity.xcodeproj/`, `entitlements/`) under this owner directory per
ADR 0027/0028. Secret bytes never transit this package's TypeScript layer;
token bytes are handled only inside the signed Token Retrieval Launcher, which
hands them to the disposable `op` child. Signing and notarization stay
operator-gated (ADR 0028 entry gate).

Current source map:

- Product charter: `docs/adr/0027-browser-use-security-is-one-product-with-three-targets.md`.
- Contract/capability split: `docs/adr/0028-auth-u3-splits-pure-contract-from-signed-native-capability.md`.
- Pure contract half: `skills/browser-use/src/`.

## Language

**Target**:
One of the three separately signed executable targets in the closed set:
Approval Broker, Token Retrieval Launcher, Confidential Field Delivery XPC. The
set is fixed by ADR 0027 — not a registry, not an extension boundary. Each
target keeps its own bundle identity, entitlements, and admission evidence, and
is verified independently.
_Developer example_: "The Token Retrieval Launcher target never receives a
browser channel."
_Avoid example_: "Register a fourth security target in the target registry."

**Admission manifest**:
The code-owned manifest (`AdmissionManifest` in `src/model.ts`) carrying exactly
one `TargetAdmissionEntry` per target. Browser Use admits one product version
while verifying every target independently. ADR 0027 requires it to be
code-owned with drift tests.
_Developer example_: "The admission manifest carries one entry per target and a
single product version."
_Avoid example_: "Let the installer own admission policy."

**Bundle-id placeholder**:
The `BUNDLE_ID_PLACEHOLDER` sentinel standing in for an unminted `com.*` bundle
id. A later unit mints the real strings via `mintedBundleId`; until then
`isMintedBundleId` rejects every placeholder, keeping admission fail-closed. The
branded `BundleId` type prevents an arbitrary string from passing as a minted id.
_Developer example_: "Admission rejects the placeholder, so nothing is admitted
until the real bundle strings are minted."
_Avoid example_: "Ship a single global stub bundle id that satisfies admission
for all three targets."

**Capability-absent posture**:
`native-capability-absent` — the legal, typed state when the native product is
not installed (ADR 0028). Every absent path stays fail-closed and never crashes
or stubs. It sits in the closed `AdmissionVerdict` union beside `admitted` and
`not-admitted`.
_Developer example_: "With no native product installed, the verdict is
`native-capability-absent`, and the contract half continues via its typed
bootstrap continuations."
_Avoid example_: "Throw when the native product is missing."

**No privilege union**:
Packaging never unions privilege or secret custody across targets (ADR 0027):
the broker receives no OP token or raw credential, the retrieval launcher
receives no browser channel, and the delivery target receives no OP token or
network entitlement.
_Developer example_: "Keep the broker's entitlements disjoint from the delivery
target's."
_Avoid example_: "Collapse the three targets into one process for simpler
packaging."
