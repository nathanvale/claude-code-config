---
title: "Hermetic Doubles Must Preserve Production Identity and Lifecycle"
date: "2026-08-04"
last_updated: "2026-08-05"
category: "architecture-patterns"
module: "browser-use"
problem_type: "architecture_pattern"
component: "testing_framework"
severity: "high"
applies_when:
  - "Hermetic doubles replace browser adapters, credential stores, approval brokers, promotion ledgers, or navigation flows"
  - "Production behavior distinguishes identifiers from different ownership namespaces"
  - "Production behavior depends on locking, history, expiry, resume, submission, or page-transition state"
related_components:
  - "authentication"
  - "database"
  - "tooling"
tags:
  - "browser-use"
  - "hermetic-testing"
  - "test-doubles"
  - "identity-namespaces"
  - "lifecycle-states"
  - "contract-testing"
  - "regression-prevention"
---

# Hermetic Doubles Must Preserve Production Identity and Lifecycle

## Context

Browser automation tests become easier when two production concepts share one fixture value or one happy-path state. That shortcut is dangerous at integration boundaries. The test can prove the local algorithm while deleting the distinction that causes the production failure.

A four-week Browser Use session survey found this pattern across six different boundaries:

- An Agent Browser tab handle and a Chrome CDP target ID were both represented as `t1`. Live code then passed the adapter handle to `Target.attachToTarget`. The current tree resolves the adapter-selected page to a browser-level target before authentication (`skills/browser-use/src/browser-use.ts:5836`) and the regression fixture rejects adapter IDs at the CDP boundary (`skills/browser-use/src/browser-use-wave3-dispatch.test.ts:407`).
- An unlocked SQLite fixture did not reproduce Chrome holding `Default/Login Data` open. The first credential-count fix passed tests but failed live with `SQLITE_BUSY`. The owner now rejects a pre-existing non-empty WAL, attempts a transactionally consistent SQLite backup, and falls back to a stable locked-file snapshot when backup cannot complete (`runtime/browser-use-environment-auth/Sources/BrowserUseEnvironmentOpSupervisor/main.swift:678`, `runtime/browser-use-environment-auth/Sources/BrowserUseEnvironmentOpSupervisor/main.swift:704`, `runtime/browser-use-environment-auth/Sources/BrowserUseEnvironmentOpSupervisor/main.swift:756`). Tests keep real exclusive locks across the check and cover unsafe and benign WAL races (`runtime/browser-use-environment-auth/Tests/BrowserUseEnvironmentAuthTests/ProfilePolicyLoginDataTests.swift:260`, `runtime/browser-use-environment-auth/Tests/BrowserUseEnvironmentAuthTests/ProfilePolicyLoginDataTests.swift:278`, `runtime/browser-use-environment-auth/Tests/BrowserUseEnvironmentAuthTests/ProfilePolicyLoginDataTests.swift:310`, `runtime/browser-use-environment-auth/Tests/BrowserUseEnvironmentAuthTests/ProfilePolicyLoginDataTests.swift:326`).
- A username-first accessibility fixture hid a live form that exposed password before username. The classifier now chooses semantic credential order independently of node order (`skills/browser-use/src/browser-use-login-engine.ts:308`), with a password-first regression (`skills/browser-use/src/browser-use-runbook-auth.test.ts:405`).
- A current promotion receipt was tested without legacy audit history. The registry now models current authority and history separately (`skills/browser-use/src/browser-use-reviewed-action-authoring.ts:86`, `skills/browser-use/src/browser-use-reviewed-action-authoring.ts:92`), and replacement tests preserve history while clearing current promotion (`skills/browser-use/src/browser-use-reviewed-action-authoring.test.ts:220`).
- A fresh approved-run fixture did not exercise resume after authority expiry. The model covers expiry and adapter drift, while an approved-submit regression now proves that an expired session attestation is renewed before exactly one dispatch (`skills/browser-use/src/browser-use-runbook-auth.ts:620`, `skills/browser-use/src/browser-use-timesheet-submit.test.ts`).
- A search-page fixture stood in for every successful submit result. A live portal instead landed on a submitted detail page, so the real mutation was reported as not achieved. The verifier now treats submitted-detail and submitted-list shapes as separate evidence paths, refuses incomplete and wrong-period detail pages, and returns the observation source (`skills/browser-use/actions/fasttrack/verify-submitted.js:59`, `skills/browser-use/src/browser-use-timesheet-verify-submitted.test.ts:137`).

These were separate defects. Their common cause was loss of production distinctions inside otherwise plausible hermetic tests.

The merged package boundary retains the same false-green shape: checking test-runtime names does not prove that the production construction path excludes caller-injected authority. The exact production-runtime gap remains documented by [Authentication Is Proven State, Not Successful Navigation](./authentication-is-proven-state-not-successful-navigation.md). This reinforces that fidelity includes construction and lifecycle, not only serialized output.

## Guidance

Treat boundary-faithful test modeling as part of the product contract. A double may simplify implementation detail, but it must preserve every identity namespace, ordering rule, lock state, lifecycle phase, and externally observable shape that production distinguishes.

### Give each identity namespace its own fixture value

Never reuse one string because two systems both call it an ID. Name the namespace at the boundary and make fixture values visibly incompatible.

```ts
const adapterTabId = "adapter-tab-t1";
const cdpTargetId = "cdp-target-auth";

fakeAdapter.select(adapterTabId);
fakeCdp.getTargets.mockReturnValue([{ targetId: cdpTargetId, url: loginUrl }]);
fakeCdp.attachToTarget.mockImplementation((targetId) => {
  if (targetId !== cdpTargetId) {
    throw new Error("adapter tab id is not a CDP target id");
  }
});
```

The fake transport must reject the adapter value when a CDP method expects the browser value. This turns accidental aliasing into a red test instead of a production-only failure.

### Reproduce operating-system state, not only file contents

A copied SQLite file is not equivalent to a database held open by Chrome. A temporary file is not equivalent to a symlinked, permission-constrained, or concurrently replaced file. When correctness depends on OS behavior, create that state with the OS primitive:

- Hold the SQLite transaction or lock during the assertion.
- Create WAL or journal variants that change safe-read semantics.
- Exercise symlink and permission ancestry with real filesystem entries.
- Cross a real child-process boundary when descriptors, signals, environment, or exit behavior matters.

### Permute observation order independently from semantic order

DOM order, accessibility order, network completion order, and event arrival order are observations. They are not automatically workflow order. Every multi-step state machine needs at least one fixture where legal observation order differs from semantic order.

For credentials, present password before username but assert username then password delivery. For ambiguous candidates, require a fail-closed result. For asynchronous workflows, vary event order where the protocol permits it.

### Model lifecycle as a matrix

Authority-bearing and resumable artifacts need lifecycle cases, not one structurally valid fixture.

| Dimension | Minimum cases |
| --- | --- |
| Authority | absent, current, expired, superseded |
| History | none, legacy entry, multiple generations |
| Run phase | initial dispatch, blocked, approved resume, post-dispatch retry |
| Persistence | in-memory result, durable state, interrupted write |
| Identity | same adapter and handoff, changed adapter, changed handoff |

Assert both action and non-action: whether dispatch occurred, whether a marker was written before dispatch, whether a second resume redispatched, and whether blocked state persisted.

### Preserve boundary-faithful output shapes

Do not reduce several production pages or protocol responses to one fixture merely because they share a business meaning. Model each shape independently, then normalize inside the owner responsible for interpretation.

For a submit verifier, cover:

- Search list with a matching submitted row.
- Submitted detail page with positive status and requested-period evidence.
- Editing or incomplete detail page.
- Submitted page for the wrong period.
- Ambiguous or partially loaded structure.

Return the evidence source with the conclusion. A hardcoded boolean hides which production shape proved the result.

### Require one proof outside the in-process fake

Hermetic tests remain the primary regression surface. A boundary-sensitive feature is incomplete until one secret-free, non-destructive acceptance proof crosses the boundary most likely to differ:

- Real CDP transport against an HTTP-served fixture.
- Real locked SQLite database.
- Real CLI process with serialized input and parsed output.
- Real crash and resume boundary with durable state.
- Real browser page for each supported result shape.

The external proof does not need broad end-to-end coverage. Its job is to falsify the double's assumptions.

### Ask what the double erases

Use one review question:

> Which values or states are different in production but identical in this fixture?

If the answer names an identity namespace, lock, lifecycle phase, ordering rule, process boundary, or response shape, split the fixture before accepting the test. A green test that cannot represent the failure state is evidence about the wrong system.

## Why This Matters

Boundary-collapsing doubles create expensive failures. The local suite is green, the implementation appears correct, and failure occurs only after attaching to a real browser, opening a live profile, resuming durable state, or interpreting an external result. Investigation starts at the wrong layer because the test evidence falsely rules out the boundary.

Preserving production distinctions gives better failures and smaller live proofs:

- A rejected adapter ID at the fake CDP transport points directly to identity translation.
- Expired authority, ambiguous proof, non-empty WAL state, and wrong-origin results remain testable.
- Distinct fixture values prevent refactors from recombining namespaces.
- Current authority and historical audit records can evolve without becoming substitutes.
- Once hermetic tests cover the state matrix, live acceptance only validates the external boundary.

The failure pattern otherwise repeats one layer deeper: the first patch satisfies the simplified fixture, then production reveals the missing lock, stale lifecycle, alternate ordering, or alternate page shape.

## When to Apply

Apply this pattern when code crosses a boundary that can rename identity, reorder observations, retain state, or change shape:

- Browser adapters mapped to CDP, Playwright, WebDriver, or native browser identifiers.
- Authentication and credential-delivery state machines.
- Databases or files read while another process owns locks or sidecars.
- Signed receipts, approvals, leases, tokens, and resumable transactions.
- Crash recovery, subprocess supervision, and durable dispatch markers.
- SPAs or external services with list, detail, redirect, loading, and error variants.
- Migrations where current and legacy records coexist.

A lightweight unit test remains appropriate for a pure transformation inside one namespace and one lifecycle phase. Escalate to the boundary-faithful matrix when the owner consumes external identity, state, or evidence.

## Examples

### Locked database state

```swift
try createLoginData(at: path, withSavedLogin: false)
let lock = try lockLoginDataExclusively(at: path)
defer {
    sqlite3_exec(lock, "ROLLBACK", nil, nil, nil)
    sqlite3_close(lock)
}
let result = try checkProfile(profile)
#expect(result["status"] == "ready")
```

The test keeps the production-relevant lock alive while the owner reads the database.

### Resumable authority

```ts
for (const scenario of [
  { authority: "fresh", expected: "dispatch-once" },
  { authority: "expired", expected: "renew-or-block-durably" },
  { authority: "adapter-changed", expected: "block" },
  { authority: "handoff-changed", expected: "block" },
  { authority: "already-dispatched", expected: "never-redispatch" },
]) {
  await assertResumeContract(scenario);
}
```

The transaction assertion must cover authority, persistence, and dispatch count together.

## Related

- [Authentication is proven state, not successful navigation](./authentication-is-proven-state-not-successful-navigation.md)
- [Browser identity boundaries require separate resolution and proof](./browser-identity-boundaries-require-separate-resolution-and-proof.md)
- [Browser Use security runtime architecture](../../../runtime/browser-use-security/ARCHITECTURE.md)
- [Migration cleanup plan: fake output parity and process-boundary proof](../../plans/2026-07-16-001-refactor-browser-use-migration-cleanup-plan.md)
- [Local broker is the human approval authority](../../adr/0020-browser-use-local-broker-is-human-approval-authority.md)
- [Disposable helpers and Session Identity Proof](../../adr/0021-only-disposable-retrieval-and-delivery-helpers-may-see-browser-secrets.md)
- [Human Identity Attestation is one-run only](../../adr/0026-human-identity-attestation-is-one-run-only.md)
- [Pure contract and signed native capability stay separate](../../adr/0028-auth-u3-splits-pure-contract-from-signed-native-capability.md)
- [Browser mechanics remain adapter-owned](../../adr/0031-browser-use-delegates-browser-mechanics-to-adapters.md)
- [Confidential delivery prototype findings](../../../skills/browser-use/docs/research/2026-07-31-confidential-delivery-prototype-findings.md)
- [PR #304: browser-use production-boundary regression gates](https://github.com/nathanvale/claude-code-config/pull/304)
