# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Browser identity and authority

### Authenticated-State Proof Candidate
Page structure that suggests an authenticated state after a pre-existing-session or post-submit observation. It is recognition evidence, not identity proof.

### Browser Target Candidate
A display-safe projection of an open page for human or agent selection. It carries a public handle and redacted page facts rather than adapter or CDP identifiers.

### Adapter Page Handle
An adapter-owned transient reference for a page or tab. Its namespace is distinct from Chrome's browser-level target identity.

### CDP Target Identity
Chrome's browser-level identity for one target, separate from an adapter page handle.

### Verified Browser Target
Protocol-sensitive evidence connecting a lane and run to a current CDP target and delivery context. Unlike a Runbook Target Binding, it is not a durable adapter reference; unlike Session Identity Proof, it does not identify the authenticated human or account.

### Runbook Target Binding
An opaque durable reference connecting one run to the same adapter-resolved target across authentication and resume, without persisting the adapter's transient page handle.

### Identity Basis
The category of evidence by which a Browser Use authentication outcome attributes the current session to a human, such as Session Identity Proof or Human Identity Attestation.

### Production Authority Boundary
The composition boundary separating production Browser Use authority owners from caller-controlled inputs and test substitutes.

### Session Identity Proof
Machine-readable evidence relating a current browser session to redacted subject, account, and tenant references.

### Human Identity Attestation
A presence-backed signed human claim about the identity and mutation target associated with a Browser Use run. It is distinct from machine Session Identity Proof.

## Authoritative owners
- Authentication recognition and admission: [`browser-use-login-engine.ts`](skills/browser-use/src/browser-use-login-engine.ts) and [`browser-use-runbook-auth.ts`](skills/browser-use/src/browser-use-runbook-auth.ts); checks: [`browser-use-login-engine.test.ts`](skills/browser-use/src/browser-use-login-engine.test.ts) and [`browser-use-runbook-auth.test.ts`](skills/browser-use/src/browser-use-runbook-auth.test.ts).
- Target identity, proof, and binding: [`browser-use-target-proof.ts`](skills/browser-use/src/browser-use-target-proof.ts) and [`browser-use-auth-bindings.ts`](skills/browser-use/src/browser-use-auth-bindings.ts); check: [`browser-use-target-proof.test.ts`](skills/browser-use/src/browser-use-target-proof.test.ts).
- Production composition: [`browser-use.ts`](skills/browser-use/src/browser-use.ts); check: [`browser-use-package-authority-boundary.test.ts`](skills/browser-use/src/browser-use-package-authority-boundary.test.ts).
- Design rationale: [browser identity boundaries](docs/solutions/architecture-patterns/browser-identity-boundaries-require-separate-resolution-and-proof.md), [authenticated-state proof](docs/solutions/architecture-patterns/authentication-is-proven-state-not-successful-navigation.md), and [human identity attestation](docs/adr/0026-human-identity-attestation-is-one-run-only.md).
