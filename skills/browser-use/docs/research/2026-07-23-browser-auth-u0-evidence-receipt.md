---
date: 2026-07-23
topic: browser-auth-u0
kind: research-evidence
status: upstream-change-required
classification: upstream-change-required
---

# Browser Authentication U0 Evidence Receipt

## Result

`upstream-change-required`

Do not start Auth Plan U5.

The run proved generic descriptor, ordering, cleanup, and Agent Browser
continuity assumptions with mock sentinels. It did not admit the required
signed App Sandbox XPC delivery path. The installed machine has no valid
code-signing identity, no visible provisioning profile, and Command Line Tools
rather than full Xcode. An ad hoc-signed embedded XPC service failed lookup with
`NSCocoaErrorDomain 4099` before descriptor transfer.

This is an environment and upstream native-security capability blocker. It
does not prove the architecture impossible or password delivery intrinsically
unsupported. It keeps password delivery unadmitted until the exact XPC path
passes.

## Contract

- Auth plan U0:
  `docs/plans/2026-07-21-003-feat-browser-use-cross-adapter-authentication-plan.md`
- Platform integration boundary:
  `docs/plans/2026-07-21-002-feat-browser-use-task-router-runbook-platform-plan.md`
- Browser Use vocabulary:
  `skills/browser-use/CONTEXT.md`
- Raw-secret process boundary:
  `docs/adr/0021-only-disposable-retrieval-and-delivery-helpers-may-see-browser-secrets.md`
- App Sandbox XPC delivery:
  `docs/adr/0022-browser-secret-delivery-uses-app-sandbox-xpc.md`
- Token custody boundary:
  `docs/adr/0023-browser-automation-token-uses-private-data-protection-keychain-group.md`
- Native product and target ownership:
  `docs/adr/0027-browser-use-security-is-one-product-with-three-targets.md`

## Environment

| Fact | Observed |
|---|---|
| macOS | 26.5 |
| Bun | 1.3.14 |
| Swift | 6.3.2 |
| Agent Browser | 0.31.2 |
| Browser Connect package | 0.1.0 |
| Valid code-signing identities | 0 |
| Visible provisioning profiles | 0 |
| Xcode | unavailable; Command Line Tools active |

## Fixture

Owned paths:

- `skills/browser-use/src/browser-auth-u0-research.test.ts`
- `skills/browser-use/src/fixtures/browser-auth-u0/`

Fixture invariants:

- Generate the `U0S-<random>` sentinel inside the disposable retrieval helper.
- Give the retrieval helper no browser endpoint or channel.
- Give the delivery target only pre-opened secret, browser-channel, and
  write-ahead descriptors.
- Emit booleans and typed blocker codes only.
- Never emit the runtime sentinel.
- Treat inherited-descriptor fallback as diagnostic evidence only.

## Probe Results

| Probe | Result | Evidence |
|---|---|---|
| Ad hoc code signature | pass | `codesign --verify --strict` passed |
| App Sandbox entitlement shape | pass | signed bundle contains `com.apple.security.app-sandbox=true` |
| App Sandbox enforcement | blocked | inherited-FD fallback reports `sandbox_enforced=false` |
| Embedded XPC service admission | blocked | service lookup failed with Cocoa error 4099 |
| XPC descriptor transfer | blocked | service never admitted; no transfer claim |
| Pre-opened connected descriptor use | pass, diagnostic only | delivery executable used inherited connected descriptor |
| Private secret pipe | pass, diagnostic only | one read succeeded; replay read returned empty |
| New network creation | inconclusive | fallback observed denial, but it is not admitted OS-containment evidence |
| Unrelated file read | inconclusive | fallback observed denial, but it is not admitted OS-containment evidence |
| Exact-origin reproof | pass | drift scenario refused before secret-pipe consumption |
| Submit write-ahead | pass | durable order: `submission_started`, then `submission_dispatched` |
| Failed-field cleanup | pass | field length proved zero before helper return |
| Helper crash/unknown effect | not proven | XPC admission blocked before crash choreography |

## Agent Browser Continuity

Browser Connect produced a verified `agent-browser` handoff. A controlled local
page then exercised one pause/resume cycle with a second CDP client acting on the
same target.

| Probe | Result |
|---|---|
| Pinned Agent Browser 0.31.2 | pass |
| Verified Browser Connect handoff | pass |
| Exact-origin reproof | pass |
| Same target before and after delivery | pass |
| Agent Browser paused during external delivery | pass |
| Fresh snapshot after delivery | pass |
| Old refs not reused | pass |
| Field cleanup | pass |
| Sentinel absent from Agent Browser stdout/stderr | pass |

This proves the lane can pause and resume around a same-target external action.
It does not replace the blocked XPC-to-browser descriptor proof.

## Portal Session Identity Proof

| Portal | Result | Exact blocker |
|---|---|---|
| Oncore | blocked | no Oncore target exists in the verified current Warm Chrome handoff |
| FastTrack360 | blocked | no FastTrack360 target exists in the verified current Warm Chrome handoff |

Legacy profile paths exist, but opening them directly would bypass Browser
Connect and cannot become U0 evidence. No cookie, bearer token, credential, or
raw identity response was inspected.

## Leak Checks

- Runtime sentinel absent from fixture stdout and stderr.
- Runtime sentinel absent from Agent Browser stdout and stderr.
- Runtime sentinel absent from helper argv.
- Retrieval helper environment empty.
- Delivery helper receives no token or endpoint string.
- The fallback receives one unrelated fixture path only as denial-probe input;
  it is not granted broad file authority.
- No screenshot, trace, video, console dump, network dump, or crash payload was
  retained as evidence.

Fixture source contains only the sentinel prefix used by leak assertions. No
runtime sentinel value persists.

## Verification

```text
bun test skills/browser-use/src/browser-auth-u0-research.test.ts
4 pass, 0 fail

bun --filter browser-use-scripts test
203 pass, 0 fail

bun --filter browser-use-scripts typecheck
pass

bun skills/browser-use/src/fixtures/browser-auth-u0/agent-browser-continuity.ts \
  /tmp/browser-auth-u0-agent-browser-handoff.json
same target, origin, cleanup, continuity, fresh snapshot, and adapter leak checks: pass
```

## Permitted Next Action

Acquire the Browser Use Security product's stable team identity, provisioning
profile, and full Xcode signing capability. Re-run the embedded signed XPC
service with no inherited-descriptor fallback, then transfer both the private
secret pipe and a pre-opened controlled browser channel through XPC.

Separately, mint verified named Warm Chrome handoffs for Oncore and FastTrack360
and run each read-only Session Identity Proof recipe.

Only a later `password-conforming` receipt permits Auth Plan U5.
