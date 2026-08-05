# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Browser identity and authority

### Authenticated-State Proof Candidate
Fresh page structure that is eligible for identity proof after a pre-existing-session or post-submit observation; it is recognition evidence only and grants no authenticated authority by itself.

### Browser Target Candidate
A display-safe projection of an open page used for human- or agent-readable selection; it carries an envelope-scoped public handle and redacted page facts, never raw adapter or CDP identifiers.

### Adapter Page Handle
An adapter-owned transient reference for a page or tab. It identifies a page only inside that adapter's namespace and cannot substitute for a browser-level CDP target identity.

### CDP Target Identity
Chrome's browser-level identity for one target, resolved from fresh browser evidence independently of an adapter page handle and consumed at the Chrome DevTools Protocol boundary.

### Verified Browser Target
Protocol-sensitive evidence that binds one lane and run to a current CDP target, expected principal, origin, frame, field, and proof digest, with fresh reproof before confidential delivery; unlike a Runbook Target Binding it is not a durable adapter reference, and unlike Session Identity Proof it does not establish the authenticated human or account.

### Runbook Target Binding
An opaque durable reference that keeps one run tied to the same adapter-resolved target across authentication and resume without persisting the adapter's transient page handle.

### Identity Basis
The single evidence form by which one Browser Use authentication outcome attributes the current session to a human: either Session Identity Proof or Human Identity Attestation.

### Production Authority Boundary
The required composition boundary that keeps caller-controlled inputs and test substitutes from selecting Browser Use credential, approval, identity-proof, or native-admission owners in a production artifact.

A complete boundary covers every production-reachable constructor, runner, export, configuration source, and environment source; absence of an approved owner produces a typed no-effect continuation.

### Session Identity Proof
Machine-readable evidence carrying redacted subject, account, and tenant references for the current browser session; its consumer binds the proof to the current target and allowed origin.

### Human Identity Attestation
A presence-backed signed claim for one Browser Use run, bound to its handoff, lane, target, origin, execution policy, and redacted identity references, then verified and consumed once before authenticated state is admitted.
