---
title: "Browser Identity Boundaries Require Separate Resolution and Proof"
date: "2026-08-04"
last_updated: "2026-08-05"
category: "architecture-patterns"
module: "browser-use"
problem_type: "architecture_pattern"
component: "authentication"
severity: "high"
applies_when:
  - "A browser workflow selects a page through one adapter and operates it through another protocol"
  - "Target identity must survive pause, resume, authentication, or confidential delivery"
  - "Multiple tabs can share one URL or origin"
  - "Human or account identity gates later business work"
  - "Public target selection must not expose adapter-private or CDP identifiers"
related_components:
  - "assistant"
  - "testing_framework"
  - "tooling"
tags:
  - "browser-use"
  - "browser-identity"
  - "target-resolution"
  - "cdp-target"
  - "adapter-boundary"
  - "identity-proof"
  - "execution-binding"
  - "fail-closed"
---

# Browser Identity Boundaries Require Separate Resolution and Proof

## Context

A browser page has several legitimate identities at once. Each belongs to a different owner and answers a different question:

- A human or agent needs a safe public handle for selecting a visible page.
- A Browser Adapter needs its own transient tab or page handle for native mechanics.
- Chrome DevTools Protocol needs Chrome's browser-level target ID.
- Authentication needs evidence about the human, account, and tenant active in that target.
- Durable execution needs an opaque target binding that can be revalidated without persisting private adapter identifiers.

Using one string for all these concepts is attractive because URLs, tab handles, and target IDs often appear to identify the same page in a small fixture. Production does not guarantee that equivalence. A URL can match several tabs. An adapter handle such as `t1` is meaningful only to that adapter. A CDP target ID comes from Chrome's target registry. A human identity statement can be valid while referring to the wrong browser target.

Browser Use therefore uses an identity pipeline, not a universal page ID. Each stage resolves or proves the identity it owns, passes only the minimum evidence forward, and fails closed when ambiguity or drift prevents a unique binding.

Public composition must preserve the same owners as the namespace pipeline. The production-runtime injection gap remains documented by [Authentication Is Proven State, Not Successful Navigation](./authentication-is-proven-state-not-successful-navigation.md); this learning keeps the narrower namespace-ownership boundary.

This learning concerns production namespace ownership. [Authentication Is Proven State, Not Successful Navigation](./authentication-is-proven-state-not-successful-navigation.md) owns authenticated-state admission. [Hermetic Doubles Must Preserve Production Identity and Lifecycle](./hermetic-doubles-preserve-production-identity-namespaces-and-lifecycle-states.md) owns test fidelity. The invariant here is narrower: **matching evidence may relate two namespaces, but no namespace substitutes for another.**

## Guidance

### Project raw pages into display-safe Browser Target Candidates

Public discovery exposes a selection surface, not adapter or browser internals.

Browser Use projects a raw adapter page into a Browser Target Candidate with an envelope-scoped ordinal, an opaque candidate ID, a redacted origin, an optional redacted path shape, and a bounded title. Raw page IDs, CDP target IDs, query strings, and fragments do not survive into the public candidate (`skills/browser-use/src/browser-use-core.ts:260`, `skills/browser-use/src/discovery-model.ts:42`).

The candidate ordinal is the public target handle and is scoped to one target envelope. It supports a request such as “select candidate 2” without exposing an adapter tab ID or pretending that the ordinal is durable browser identity.

```text
Browser Target Candidate
  candidate_ordinal: 2          public, envelope-scoped handle
  candidate_id:      <opaque>   binding material
  origin:            https://portal.example
  path_shape:        /reports/:id
  title:             Reports
```

Origin, path, and title help select a page. They do not prove that a later Chrome target, account, or session is the same entity.

### Keep the Adapter Page Handle transient and adapter-owned

The selected adapter owns native page and tab mechanics. Its page handle belongs only to that adapter's process and protocol.

Agent Browser target resolution returns the raw tab ID and observed URL for immediate execution while exposing an opaque candidate binding for durable state (`skills/browser-use/src/browser-use-agent-browser.ts:232`). The owner directs callers to persist only the binding and pass the raw tab ID directly to the immediate executor (`skills/browser-use/src/browser-use-agent-browser.ts:639`).

Do not:

- Publish the raw adapter handle as the public target handle.
- Persist it as durable run identity.
- Pass it to `Target.attachToTarget` as though it were a CDP target ID.
- Re-run auto-selection on resume and silently bind a different tab.

An exact adapter handle may be an input override, but it remains input-only. Automatic resume uses the stored opaque candidate binding (`skills/browser-use/src/browser-use-agent-browser.ts:203`).

### Resolve Chrome CDP Target Identity independently

When a CDP operation needs a target, ask Chrome for current browser-level evidence. Never translate an adapter handle by convention.

The CDP resolver has no adapter tab-ID input. It calls `Target.getTargets`, filters page targets, matches the expected URL first and then its origin, and succeeds only when the evidence identifies exactly one target (`skills/browser-use/src/browser-use-target-proof.ts:83`, `skills/browser-use/src/browser-use-target-proof.ts:122`). It returns Chrome's target ID, current top-level URL, and normalized top-level origin.

> A URL is matching evidence used to resolve a current Chrome target. It is not the target identity.

The resolver returns `target-proof-invalid` when the highest-precedence matching tier is ambiguous: multiple exact-URL matches, or, when no exact URL matches, multiple exact-origin matches. If the unique target's origin is outside the exact allowed-origin set, it returns `origin-mismatch` (`skills/browser-use/src/browser-use-target-proof.ts:142`, `skills/browser-use/src/browser-use-target-proof.ts:181`).

Only the resolved CDP Target Identity crosses the CDP boundary. Target proof attaches using the target ID produced by browser-level resolution (`skills/browser-use/src/browser-use-target-proof.ts:343`).

The public Runbook path follows this ownership boundary. It takes the URL observed by adapter target resolution, independently resolves one browser-level CDP identity from fresh Chrome evidence, and passes that CDP target ID into authentication (`skills/browser-use/src/browser-use.ts:5571`, `skills/browser-use/src/browser-use.ts:5836`).

### Bind protocol-sensitive proof to fresh browser identity

Resolution identifies one current Chrome target. Protocol-sensitive work needs a richer proof tied to the run and the field being operated.

The target-proof owner observes the resolved target, top-level origin, page, frame, field role, accessible name, and backend node (`skills/browser-use/src/browser-use-target-proof.ts:311`, `skills/browser-use/src/browser-use-target-proof.ts:425`). It mints a Verified Browser Target bound to the lane, run, account reference, and proof digest, plus a closure that freshly re-observes the same target before delivery (`skills/browser-use/src/browser-use-target-proof.ts:458`).

Reproof refuses candidates whose lane, run, target, or account reference differs. Fresh observation then detects origin, frame, field, or digest drift. Resolution and reproof are separate because a target can change after it was selected.

### Prove human and account identity separately

Knowing the exact Chrome target does not establish who is authenticated inside it. Human and account identity needs its own Identity Basis.

Browser Use models Session Identity Proof and Human Identity Attestation as the two allowed bases (`skills/browser-use/src/browser-use-auth-model.ts:372`). A successful Session Identity Proof carries target, page, frame, origin, subject, account, tenant, and identity-basis references (`skills/browser-use/src/browser-use-login-engine.ts:60`). The Runbook owner checks the proof target against the resolved CDP target and checks its origin against the allowed-origin set before recording authenticated state (`skills/browser-use/src/browser-use-runbook-auth.ts:136`).

Identity Basis answers “which human, account, and tenant does this session represent?” It does not replace public selection, adapter target resolution, CDP target resolution, exact-origin admission, or current target revalidation.

Production now has a signed, one-run Human Identity Attestation fallback, while machine Session Identity Proof remains unowned. The current limits are documented in [Authentication Is Proven State, Not Successful Navigation](./authentication-is-proven-state-not-successful-navigation.md). Neither state collapses the namespaces: the human fallback binds its claim to the resolved target, and missing machine proof remains explicit.

### Revalidate the adapter binding after authentication

Authentication can take time and navigate the page. A target that was correct before authentication may close, move, or be replaced before business work.

After authentication, the Runbook path resolves the adapter task target again through the verified handoff. It compares the new opaque candidate binding with the Runbook Target Binding selected before authentication and refuses with `agent_browser_target_moved` when they differ (`skills/browser-use/src/browser-use.ts:5951`, `skills/browser-use/src/browser-use.ts:5978`). Business execution begins only after that comparison.

This check is not redundant with Session Identity Proof. Session Identity Proof binds human and account evidence to a CDP target and origin. The second adapter resolution proves that the adapter is still about to operate the same opaque target candidate selected for the run. Each owner can observe drift only in its own namespace.

Confidential-delivery resume follows the same rule. Resume refuses a different CDP target, discards pre-delivery refs, and requires a fresh accessibility snapshot (`skills/browser-use/src/browser-use-agent-browser.ts:1321`). A fresh observation on another target is not continuity on the verified target.

### Fail closed on ambiguity, absence, or drift

Return typed repair truth and perform no business mutation or further automatic retry when:

- Public selection has zero or multiple admissible candidates.
- An opaque bound adapter target no longer resolves.
- Browser-level URL or origin evidence resolves zero or multiple CDP targets.
- The resolved Chrome target is outside allowed-origin policy.
- Session identity proof names another target or origin.
- Human or account identity is unavailable or conflicting.
- Post-auth adapter resolution produces another candidate binding.
- Resume offers another CDP target or cannot produce fresh observation evidence.

Keep repair scoped to the owner. Candidate ambiguity asks for a smaller admissible set. A stale adapter binding asks to restore the original target or replace the run. CDP ambiguity asks for unique current browser evidence. Identity-proof failure asks for repaired machine proof or bounded human attestation. These are different repairs because they restore different identities.

## Why This Matters

Identity substitution creates failures that look locally reasonable:

- A public ordinal is reused outside its envelope and selects another page.
- An adapter tab handle is sent to CDP and attaches to nothing or the wrong target.
- A URL match selects the first of two same-origin tabs.
- Correct account evidence from one frame is applied to another target.
- A resumed run silently auto-selects a replacement tab.
- Authentication succeeds, then business work runs in a target that moved.

Separate types, owners, and resolution steps make the missing proof visible. The failure names the broken boundary: public selection, adapter target, CDP target, origin policy, human identity, or durable binding.

The pipeline also limits disclosure. Humans and agents receive redacted display facts. Durable state retains an opaque binding. Adapter-private IDs remain transient. Chrome target IDs appear only where browser-level operations need them. Human and account evidence remains separate from URLs and tab handles.

Most importantly, authority cannot leak sideways. Matching a URL cannot manufacture target identity. Resolving a CDP target cannot manufacture account identity. Proving an account cannot authorize another adapter target. Each successful boundary supplies evidence to the next without taking ownership of it.

## When to Apply

Apply this pattern when:

- A browser workflow crosses public UI, adapter, CDP, and authentication layers.
- More than one page can share an origin, route, or title.
- Adapter page handles are process-local or adapter-specific.
- A run persists target identity across authentication, pause, crash, or resume.
- Confidential delivery attaches through CDP while browser mechanics remain adapter-owned.
- The expected human, account, tenant, or workspace matters to later effects.
- Public discovery must avoid exposing raw page or target identifiers.
- A target can navigate or be replaced between selection and business dispatch.

The same pattern applies to other multi-owner identity systems. A UI row, database key, remote-provider object ID, and human account claim may describe one conceptual object while remaining distinct identities with separate resolution and proof owners.

## Examples

### Anti-pattern: one identifier crosses every boundary

```ts
const selected = publicCandidate.id; // "t1"

await adapter.selectTab(selected);
await cdp.send("Target.attachToTarget", { targetId: selected });
await markAuthenticated({ target: selected, account: expectedAccount });
await persistRun({ target: selected });
```

This assumes the public handle, adapter handle, CDP target ID, authenticated target, and durable binding share one namespace. No contract establishes that equivalence.

### Pattern: resolve and prove at every owner boundary

```ts
const candidate = selectDisplaySafeCandidate(envelope, candidateOrdinal);

const adapterTarget = await adapter.resolveTarget({
  candidateBinding: candidate.privateBinding,
});
if (!adapterTarget.ok) return blocked(adapterTarget.cause);

const cdpTarget = await resolveCdpTargetIdentity({
  expected_url: adapterTarget.currentUrl,
  allowed_origins,
});
if (!cdpTarget.ok) return blocked(cdpTarget.cause);

const identity = await proveSessionIdentity({
  target_id: cdpTarget.target_id,
  allowed_origins,
  expectedPrincipal,
});
if (!identity.proven) return blocked(identity.cause);

const currentAdapterTarget = await adapter.resolveTarget({
  candidateBinding: candidate.privateBinding,
});
if (!currentAdapterTarget.ok) return blocked(currentAdapterTarget.cause);
if (currentAdapterTarget.binding !== adapterTarget.binding) {
  return blocked("target-moved");
}

return dispatchBusinessWork(currentAdapterTarget.transientHandle);
```

The URL helps resolve the CDP target but never becomes its ID. Session Identity Proof binds the expected principal to that target but never becomes an adapter handle. The durable binding lets the adapter re-resolve current execution truth without exposing the raw handle publicly.

### Identity pipeline map

```text
raw adapter listing
        |
        v  redact and envelope-scope
Browser Target Candidate
        |
        v  resolve through verified adapter handoff
transient Adapter Page Handle + opaque Runbook Target Binding
        |
        v  match fresh browser-level URL and origin evidence
Chrome CDP Target Identity
        |
        v  prove exact current human, account, and tenant
Session Identity Proof or Human Identity Attestation
        |
        v  re-resolve adapter binding after authentication
current business-execution target
```

Every arrow is a resolution or proof step. None is a cast.

### Same URL, two tabs

Two Chrome page targets expose the same reports URL. The URL is valid matching evidence but does not uniquely identify either target. Browser-level resolution returns `target-proof-invalid`, not the first target in the list (`skills/browser-use/src/browser-use-target-proof.ts:142`).

### Bound target moved during authentication

The run selects an adapter target and persists its opaque binding. Authentication navigates or closes the tab. Before the first business step, adapter resolution returns another candidate binding. The Runbook path refuses with `agent_browser_target_moved` instead of treating successful authentication as permission to use the replacement (`skills/browser-use/src/browser-use.ts:5978`).

## Related

- [Authentication is proven state, not successful navigation](./authentication-is-proven-state-not-successful-navigation.md)
- [Hermetic doubles must preserve production identity and lifecycle](./hermetic-doubles-preserve-production-identity-namespaces-and-lifecycle-states.md)
- [Browser Use delegates browser mechanics to adapters](../../adr/0031-browser-use-delegates-browser-mechanics-to-adapters.md)
- [Browser Adapter Router uses evidence-first routing](../../adr/0012-browser-adapter-router-uses-evidence-first-routing.md)
- [Runbook target resolution plan](../../plans/2026-07-28-002-fix-runbook-target-resolution-plan.md)
- [Confidential delivery prototype findings](../../../skills/browser-use/docs/research/2026-07-31-confidential-delivery-prototype-findings.md)
- [Browser target proof tests](../../../skills/browser-use/src/browser-use-target-proof.test.ts)
- [Issue #267: runbook default tab cannot bind a catalog target](https://github.com/nathanvale/claude-code-config/issues/267)
- [PR #268: auto-resolve omitted runbook targets](https://github.com/nathanvale/claude-code-config/pull/268)
- [PR #284: route operate per lane with opaque adapter page refs](https://github.com/nathanvale/claude-code-config/pull/284)
- [PR #304: browser-use production-boundary regression gates](https://github.com/nathanvale/claude-code-config/pull/304)
