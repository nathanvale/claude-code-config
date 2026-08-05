# Browser Use Compound Follow-ups

Status: active

Owner: Browser Use

Source: Browser Use four-week survey compounds, PR #303 merge commit `41a0b606`, and PR #300 merge head `285b4948`.

## Candidate order

- [x] 1. Hermetic doubles must preserve production identity namespaces and lifecycle states.
- [x] 2. Authentication is proven state, not successful navigation.
- [x] 3. Browser identity boundaries require separate resolution and proof.
- [x] 4. Production authority must be unreachable through test injection seams.
- [x] 5. Resume flows must revalidate expiry, target, adapter, and identity.
- [x] 6. Browser fixtures must preserve real page shape, ordering, locks, and output semantics.

## 1. Land the compounds

- [x] Review the solution documents together.
- [x] Review `CONCEPTS.md`.
- [x] Review the AGENTS discoverability change.
- [x] Run compound validators again.
- [x] Create a dedicated documentation branch or PR.
- [x] Commit and publish only after approval.

## 2. Close completed plans

- [x] Mark the PR #303 regression-closure plan completed against its final merged head.
- [x] Add verification evidence and retained deferrals.
- [x] Mark the Runbook CRUD front-door plan implemented.
- [x] Mark the Runbook target-resolution plan completed.
- [x] Resolve its stale unchecked completion boxes with evidence.
- [x] Mark the opaque-page-ref plan completed.
- [x] Record its shipped adapter-identity boundary.

## 3. Correct materially stale plans

- [x] Update the confidential-delivery plan's obsolete stub claim.
- [x] Record the shipped CDP and Verified Browser Target wiring.
- [x] Separate hermetic completion from missing native and live proof.
- [x] Add a current-status overlay to the cross-adapter authentication plan.
- [x] Record which Agent Browser pieces shipped.
- [x] Preserve unsupported lanes and production identity proof as remaining work.
- [x] Add a current-status overlay to the task-router and Runbook-platform plan.
- [x] Preserve historical requirements and decisions.

## 4. Refresh the acceptance ledger

- [x] Reassess Runbook authoring rows.
- [x] Reassess activation and immutable-generation rows.
- [x] Reassess target-resolution and continuity rows.
- [x] Reassess generic authentication and restart rows.
- [x] Attach current deterministic evidence to each changed verdict.
- [x] Keep live-only rows blocked or partial without live proof.
- [x] Keep `DDA-F08` failed until production identity proof exists.
- [x] Keep wrong-account prevention red until expected-principal proof exists.

## 5. Plan production identity authority

- [ ] Create a focused implementation plan separate from PR #303.
- [ ] Choose the production Session Identity Proof owner.
- [ ] Define expected subject, account, and tenant inputs.
- [ ] Define proof evidence, freshness, and mismatch outcomes.
- [ ] Preserve separate target, origin, adapter, and run bindings.
- [ ] Prevent caller injection through production composition.
- [ ] Define production discovery, admission, repair, and upgrade behavior.

## 6. Complete Human Identity Attestation

- [x] Retain Human Identity Attestation as a supported fallback.
- [x] Bind the exact run and handoff.
- [x] Bind target, page, frame, and origin.
- [x] Bind claimed subject, account, and tenant references.
- [x] Add freshness and expiry.
- [x] Add durable one-use assignment and consumption.
- [ ] Prevent Human Identity Attestation from overriding stable mismatch evidence.
- [ ] Add cross-runtime receipt vectors.
- [x] Add replay, mutation, and wrong-context refusal tests.

## 7. Add production-boundary acceptance proof

- [ ] Prove production composition supplies only approved authority.
- [ ] Prove real CDP resolution uses the CDP target namespace.
- [ ] Cover duplicate exact-URL and exact-origin candidates.
- [ ] Cover target movement during authentication.
- [ ] Cover crash and resume after credential submission.
- [ ] Cover authenticated resume with fresh identity proof.
- [ ] Keep proof secret-free and non-destructive.
- [ ] Keep real portal mutation behind separate authority.

## 8. Institutionalize hermetic-test fidelity

- [ ] Use visibly different adapter and CDP fixture IDs.
- [ ] Make fake transports reject namespace substitution.
- [ ] Cover password-first accessibility ordering.
- [ ] Cover absent, current, expired, and superseded authority.
- [ ] Cover initial, blocked, resumed, and already-dispatched phases.
- [ ] Cover unsafe and benign SQLite and WAL races.
- [ ] Cover list, detail, incomplete, wrong-period, and ambiguous page shapes.
- [ ] Require one external-boundary proof for boundary-sensitive features.

## 9. Final closure

- [x] Run plan and ledger link checks.
- [x] Run Markdown and YAML validation.
- [x] Run `ce-compound-refresh` over the Browser Use solution set.
- [x] Confirm plans, ledger, concepts, and solutions agree.
- [x] Run skill-feedback closeout.
- [x] Review the final diff.
- [x] Request commit and publication approval.
