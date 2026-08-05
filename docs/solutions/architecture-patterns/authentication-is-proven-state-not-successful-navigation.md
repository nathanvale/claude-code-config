---
title: "Authentication Is Proven State, Not Successful Navigation"
date: "2026-08-04"
last_updated: "2026-08-05"
category: "architecture-patterns"
module: "browser-use"
problem_type: "architecture_pattern"
component: "authentication"
severity: "high"
applies_when:
  - "A browser workflow must decide whether the current session is authenticated"
  - "Credential submission can land on redirects, challenges, or markerless pages"
  - "A durable browser run resumes after submission or authentication"
  - "Multiple accounts, tenants, profiles, tabs, or frames can reach the same portal"
  - "A later business action depends on the expected account, tenant, target, or origin"
related_components:
  - "assistant"
  - "testing_framework"
tags:
  - "browser-use"
  - "authentication"
  - "identity-proof"
  - "authenticated-state"
  - "post-submit"
  - "fail-closed"
  - "session-resume"
  - "wrong-account"
---

# Authentication Is Proven State, Not Successful Navigation

## Context

Browser navigation answers where the browser went. It does not answer whose session is active, whether the expected tenant is selected, or whether the page is safe for the next business action. A redirect, disappeared login form, dashboard heading, or HTTP success can nominate a state for inspection, but none grants authority by itself.

Browser Use separates three decisions:

1. **Recognition:** Does fresh page structure qualify as an Authenticated-State Proof Candidate?
2. **Identity proof:** Does an approved proof owner establish session identity for this run?
3. **Execution admission:** Are target, origin, handoff, adapter, run, and freshness bindings still valid immediately before business work?

The login engine recognizes a conventional signed-in page only when credential fields and enabled advance controls are absent and either a signed-in marker or bounded application structure appears on the expected target and allowed origin. It also recognizes a markerless post-submit page only when credential fields, advance controls, and challenges are absent (`skills/browser-use/src/browser-use-login-engine.ts:364`, `skills/browser-use/src/browser-use-login-engine.ts:419`). Both shapes are candidates only. Success requires `proveAuthenticatedState` to return a proof record (`skills/browser-use/src/browser-use-login-engine.ts:604`).

That proof port receives the lane, run, target, expected URL, allowed origins, approved credential binding, current accessibility snapshot, and transition kind. A successful record carries target, page, frame, origin, subject, account, tenant, and identity-basis references (`skills/browser-use/src/browser-use-login-engine.ts:60`). Page structure decides when to ask; the proof owner decides whether authentication is established.

Production-factory filtering alone does not close this boundary. The current package exports a CLI runner that accepts a complete caller-supplied runtime and a `runForTest` helper that forwards that runtime (`skills/browser-use/src/browser-use.ts:364`, `skills/browser-use/src/browser-use.ts:8189`). A correct proof gate remains bypassable while another production-reachable seam can replace its authority owner.

## Guidance

### Treat navigation and page shape as recognition only

Never make `navigate()`, a URL match, missing credential fields, or signed-in words directly set authenticated state. Use those observations only to create a bounded proof candidate.

The current engine admits a markerless post-submit candidate after submission and can recognize a pre-existing session from substantive application structure only on the expected target and allowed origin. A candidate without successful proof returns a typed blocked result. Post-submit refusal becomes `unknown-post-submit-state`; a pre-existing candidate without machine proof may enter the bounded human-attestation path (`skills/browser-use/src/browser-use-login-engine.ts:364`, `skills/browser-use/src/browser-use-login-engine.ts:604`).

Keep recognition generic. Use semantic accessibility structure and bounded transitions, not portal names, route strings, or one product's dashboard label.

### Require one explicit Identity Basis

An authenticated outcome names exactly one Identity Basis:

- **Session Identity Proof:** machine-readable evidence from an approved proof owner.
- **Human Identity Attestation:** a bounded human claim when stable machine proof is unavailable.

The auth model contains exactly those two basis values, and an authenticated terminal fragment requires both an attestation reference and an identity-basis reference (`skills/browser-use/src/browser-use-auth-model.ts:372`, `skills/browser-use/src/browser-use-auth-model.ts:882`). Human Identity Attestation is intended for one exact run and cannot override stable mismatch evidence or become standing authorization ([ADR 0026](../../adr/0026-human-identity-attestation-is-one-run-only.md)).

Never degrade from failed machine proof to page heuristics. Missing or conflicting evidence returns a typed continuation.

### Keep identity proof separate from target and origin admission

Identity evidence does not replace browser-target evidence. The Runbook authentication owner rejects a different target as `target-proof-invalid` and an unapproved or malformed origin as `origin-mismatch` (`skills/browser-use/src/browser-use-runbook-auth.ts:123`).

The public Runbook path resolves one browser-level CDP target from fresh evidence before authentication (`skills/browser-use/src/browser-use.ts:5355`). After authentication it resolves the adapter task target again and compares the opaque candidate binding before business execution (`skills/browser-use/src/browser-use.ts:5455`, `skills/browser-use/src/browser-use.ts:5475`). Identity, CDP target, adapter target, and origin are related gates, not interchangeable evidence.

### Re-prove current state on resume

Persist enough transaction state to distinguish pre-submit, submission-started, post-submit-proof, authenticated, and mutation-dispatched phases. Never infer a resumed phase from whatever page happens to be visible.

For persisted post-submit-proof state, the Runbook owner takes a fresh snapshot and calls the proof port again. Missing authority or failed proof blocks without replaying credentials (`skills/browser-use/src/browser-use-runbook-auth.ts:565`, `skills/browser-use/src/browser-use-runbook-auth.ts:590`). For an authenticated resume, it obtains another snapshot and fresh identity proof, revalidates the stored attestation, and, if the old attestation alone expired, persists a fresh attestation before continuing (`skills/browser-use/src/browser-use-runbook-auth.ts:620`, `skills/browser-use/src/browser-use-runbook-auth.ts:656`, `skills/browser-use/src/browser-use-runbook-auth.ts:696`). A submission-started restart remains unknown because an external effect may already have happened.

Revalidation is a set of separate gates. A continuation preserves workflow position, never authority:

| Gate | Fresh question | Refusal |
| --- | --- | --- |
| Transaction phase | What may have happened before the process stopped? | Preserve unknown effect; never replay submission |
| Expiry | Is the attestation still inside its freshness window? | `attestation_expired` |
| Adapter and handoff | Is this the same lane and admitted browser connection? | `attestation_lane_changed` or `attestation_handoff_changed` |
| Session identity | Does a fresh snapshot still produce approved identity proof? | Typed proof continuation |
| Adapter target | Does fresh resolution produce the original opaque target binding? | `agent_browser_target_moved` |
| CDP target | Is confidential-delivery resume still on the exact verified browser target? | `agent_browser_resume_target_mismatch` |

The run-model owner checks state, expiry, adapter, and handoff before delegating digest, run, environment, profile, and freshness verification to the auth contract (`skills/browser-use/src/browser-use-run-model.ts:1280`, `skills/browser-use/src/browser-use-auth.ts:75`). The public execution path repeats attestation validation, then re-resolves and compares the adapter target before business dispatch (`skills/browser-use/src/browser-use.ts:5931`, `skills/browser-use/src/browser-use.ts:5951`). Confidential-delivery resume separately rejects a different CDP target, discards stale refs, and requires a fresh snapshot (`skills/browser-use/src/browser-use-agent-browser.ts:1321`).

Identity continuity remains proof-owner work. Ready resume requests fresh proof and the consumer checks target and origin, but subject, account, tenant, and identity-basis semantics come from the selected proof owner (`skills/browser-use/src/browser-use-runbook-auth.ts:136`, `skills/browser-use/src/browser-use-runbook-auth.ts:590`). Production now has a signed Human Identity Attestation owner, but still has no machine Session Identity Proof owner. Do not describe automated wrong-account detection as operationally complete. A previously valid proof is not permanent authority.

### Fail closed with one next safe action

When authentication cannot be proven, stop before business dispatch and return one typed continuation:

| Cause | Meaning | Continuation |
| --- | --- | --- |
| `human-identity-attestation-required` | No approved identity basis is available | Complete bounded human identity attestation |
| `unknown-post-submit-state` | Submission may have changed state but proof cannot establish the result | Inspect the post-submit state; never retry automatically |
| `origin-mismatch` | Proof and exact-origin policy disagree | Repair or re-establish the correct origin context |
| `target-proof-invalid` | The browser target is no longer the bound target | Re-resolve and re-prove the target |

The model maps unknown post-submit state to `inspect-post-submit-state` and forbids automatic retry (`skills/browser-use/src/browser-use-auth-model.ts:310`). Tests cover proof refusal, moved-origin refusal, fresh restart proof without credential replay, and missing proof authority (`skills/browser-use/src/browser-use-runbook-auth.test.ts:400`, `skills/browser-use/src/browser-use-runbook-auth.test.ts:414`, `skills/browser-use/src/browser-use-runbook-auth.test.ts:539`).

### Preserve the authority boundary in production composition

Hermetic tests may inject a deterministic proof port. Production construction must obtain authority only from approved production owners.

The production factory does not accept identity-proof, credential, approval, or native-security authority ports (`skills/browser-use/src/browser-use.ts:325`). Factory type and JavaScript-extra-key tests reject direct production-factory authority injection. A built-package regression also supplies hostile environment and config keys while checking selected test-factory names (`skills/browser-use/src/browser-use-package-authority-boundary.test.ts:16`, `skills/browser-use/src/browser-use-package-authority-boundary.test.ts:48`).

Those checks are necessary but not sufficient. `runBrowserUseCli` still accepts `options.runtime?: BrowserUseRuntime` and prefers it over production construction (`skills/browser-use/src/browser-use.ts:364`). The same production entry module exports `runForTest`, which forwards its supplied runtime into that path (`skills/browser-use/src/browser-use.ts:8189`). The bundle assertion filters export names matching `RuntimeForTest`, so it does not reject the exported `runForTest` symbol (`skills/browser-use/src/browser-use-package-authority-boundary.test.ts:76`).

Treat production authority as a reachability property across the whole artifact, not a property of one constructor:

- Make the executable path construct its production runtime unconditionally.
- Move runtime-injectable runners into a test-only module outside the production bundle graph.
- Check the complete built export surface against an allowlist.
- Attempt hostile injection through every production-reachable runner, config path, and environment path.
- Keep the missing-owner public-route test as the terminal fail-closed proof.

The invariant is: no production-reachable function can accept a caller-supplied proof, approval, credential, native-security owner, or runtime containing one. TypeScript excess-property rejection does not enforce this for JavaScript callers, and a safe factory does not protect a separate exported runner.

This leaves one intentional current limitation: production Session Identity Proof is not operationally enabled. A production-shaped run without either machine proof or Human Identity Attestation stops before browser dispatch (`skills/browser-use/src/browser-use.ts:5523`).

Human Identity Attestation is now a production-wired fallback. Production runtime construction discovers the pinned ApprovalBroker verifier and composes the native driver when the broker is admitted (`skills/browser-use/src/browser-use-runtime.ts:1358`, `skills/browser-use/src/browser-use-runtime.ts:1373`). The driver requires the exact durable user-presence gate, binds run, handoff, lane, target, origin, environment, profile, action policy, and redacted subject/account/tenant references, verifies the signed grant against the pinned key, and consumes it once (`skills/browser-use/src/browser-use-human-identity-attestation.ts:353`, `skills/browser-use/src/browser-use-human-identity-attestation.ts:386`). Its fresh-until value comes from the broker grant rather than page heuristics.

The two bases make different claims. Session Identity Proof is machine evidence and must establish expected-identity semantics. Human Identity Attestation is an explicit human-approved claim over binding-derived redacted references; it does not turn page structure into machine proof. Keep automated wrong-account prevention blocked until a production Session Identity Proof owner defines and proves expected subject, account, and tenant semantics.

## Why This Matters

A successful redirect is compatible with unsafe states:

- Credentials succeeded under the wrong account or tenant.
- A stale session was already authenticated as another person.
- The browser reached a challenge, interstitial, or error page with no login fields.
- A single-page application changed structure before identity evidence became available.
- Proof belongs to another tab, frame, origin, handoff, or resumed run.
- The session expired or drifted between observation and business dispatch.

Collapsing recognition, identity proof, and execution admission makes these states indistinguishable. The result is false-positive authentication exactly where later actions may mutate external data.

The layered pipeline makes each concern independently testable. Recognition tests cover markerless and delayed transitions without inventing identity authority. Proof-owner tests cover expected-account evidence. Target and origin tests cover drift. Restart tests prove zero credential replay and zero duplicate dispatch. The same markerless candidate authenticates with fresh proof and returns `unknown-post-submit-state` when proof is absent or refused (`skills/browser-use/src/browser-use-login-engine.test.ts:593`).

## When to Apply

Apply this pattern when:

- A workflow submits credentials or resumes a browser session before external reads or writes.
- Success pages vary, omit stable signed-in labels, or transition asynchronously.
- Multiple accounts, tenants, workspaces, or identities share one portal.
- A run can pause, crash, or resume after credential submission.
- Browser adapters use local page handles distinct from browser-level target identities.
- A human may attest identity when stable machine evidence is unavailable.
- Authentication gates a business action whose duplicate or wrong-account effect matters.

The same separation applies outside browser automation. OAuth callbacks, device authorization, desktop deep links, and asynchronous login redirects all produce recognition events before trustworthy current identity state.

## Examples

### Anti-pattern: navigation grants authentication

```ts
await page.click("Sign in");
await page.waitForURL("**/dashboard");

return {
  authenticated: true,
  account: expectedAccount,
};
```

The URL establishes reachability, not the session subject, account, tenant, or target binding.

### Pattern: recognize, prove, bind, revalidate

```ts
const snapshot = await observer.snapshot({ target_id });
const candidate = recognizeAuthenticatedState(snapshot);

if (!candidate) return blocked("unknown-post-submit-state");

const identity = await proveAuthenticatedState({
  run_id,
  target_id,
  allowed_origins,
  snapshot,
  transition: "post-submit",
});

if (!identity.proven) return blocked("unknown-post-submit-state");

assertExactTarget(identity.proof.target_id, target_id);
assertAllowedOrigin(identity.proof.origin, allowed_origins);
await persistAuthenticatedAttestation(identity.proof);

const current = await revalidateBeforeBusinessDispatch();
if (!current.valid) return blocked(current.cause);

return dispatchBusinessStepOnce();
```

The exact APIs vary. The invariant does not: page state may nominate a candidate, but only explicit identity evidence plus current binding checks authorizes the next step.

### Resume after submission

```text
persisted phase: post-submit-proof
        |
        v
fresh snapshot on the bound target
        |
        v
fresh identity proof
   | success                 | missing or refused
   v                         v
bind attestation       typed blocked continuation
   |
        v
revalidate run, handoff, adapter, freshness, target, and origin gates
        |
        v
dispatch business work once
```

Never click Submit again during this recovery path. Restart tests obtain fresh proof without credential replay and preserve unknown state when submission may already have occurred (`skills/browser-use/src/browser-use-runbook-auth.test.ts:428`, `skills/browser-use/src/browser-use-runbook-auth.test.ts:512`).

## Related

- [Hermetic doubles must preserve production identity and lifecycle](./hermetic-doubles-preserve-production-identity-namespaces-and-lifecycle-states.md)
- [Browser identity boundaries require separate resolution and proof](./browser-identity-boundaries-require-separate-resolution-and-proof.md)
- [Cross-adapter authentication plan](../../plans/2026-07-21-003-feat-browser-use-cross-adapter-authentication-plan.md)
- [Human Identity Attestation is one-run only](../../adr/0026-human-identity-attestation-is-one-run-only.md)
- [Disposable retrieval and delivery helpers](../../adr/0021-only-disposable-retrieval-and-delivery-helpers-may-see-browser-secrets.md)
- [Login engine authenticated-state tests](../../../skills/browser-use/src/browser-use-login-engine.test.ts)
- [Runbook authentication proof and restart tests](../../../skills/browser-use/src/browser-use-runbook-auth.test.ts)
- [PR #304: browser-use production-boundary regression gates](https://github.com/nathanvale/claude-code-config/pull/304)
- [PR #258: Browser Authentication Transaction](https://github.com/nathanvale/claude-code-config/pull/258)
