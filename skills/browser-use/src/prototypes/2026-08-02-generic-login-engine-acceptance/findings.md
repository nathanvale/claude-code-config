# Generic login engine acceptance findings

Lane: post-build acceptance of the existing `runBrowserUseLoginEngine`
implementation, used as pre-build evidence for the CRUD plan's login boundary.
Real Agent Chrome through a verified `browser-connect` endpoint. Localhost
fixtures only. Dummy credential values only.

## Question

Can one generic engine, with no portal-specific selectors or step ordering,
complete representative Oncore, UniFi, FastTrack, and OTP login shapes while
failing an ambiguous shape closed before any write?

## Exact call sequence

```text
cd skills/browser-use
bun run prototype:generic-login-engine
```

The runner internally calls `browser-connect connect agent-browser --json`,
serves each fixture over an ephemeral localhost port, imports the production
`runBrowserUseLoginEngine`, `createBrowserUseCdpObserver`, and
`mintBrowserUseVerifiedTarget` implementations, then closes every fixture tab.

## Results

| Capability class | Engine trace | Structural verdict |
| --- | --- | --- |
| Oncore-style combined form | username → password → submit | PASS: committed both fields; signed-in marker present |
| UniFi-style password-only | password → submit | PASS: committed password; signed-in marker present |
| FastTrack-style unlabelled multi-step | username → submit → password → submit | PASS: structural fallback classified both screens; signed-in marker present |
| MATest-style OTP | username → submit → password → submit → OTP → submit | PASS: all fields committed; signed-in marker present |
| Ambiguous unlabelled near-miss | no actions | PASS: refused with `human-identity-attestation-required`; zero writes and zero activations |

Overall verdict: **PASS**. Four positive shapes completed through the same
engine. The planted near-miss fired the fail-closed branch. Portal-specific
engine branches: zero.

## What this proves

- Different login shapes do not require per-portal login runbooks.
- Portal-specific data can stay at the binding/origin boundary.
- The engine can discover combined, password-only, multi-step, and OTP flows
  from fresh accessibility structure.
- Ambiguity stops before credential retrieval or page mutation.

## Limits

- The MATest case proves the OTP capability class, not the current live MATest
  page shape. Confirm that shape read-only before claiming portal-specific
  parity.
- This acceptance runner uses dummy delivery through the real engine seams. The
  separate confidential-delivery receipts own real custody and leak-sweep proof.
- The engine is currently referenced by its tests but not wired into a public
  `browser-use` login command or task intent. Product integration remains work.

## Plan effect

- Remove the portal-specific UniFi login runbook from the CRUD plan.
- Keep CRUD focused on declarative task runbooks; use a read-only UniFi
  login-screen verification runbook or a served fixture as its first consumer.
- Plan generic-login-engine product wiring separately: binding lookup, public
  command/task routing, run lifecycle, and post-build acceptance against the
  real portals at the operator-gated boundary.
