# Build the Browser Use Binding Catalog

Date: 2026-08-04

Status: accepted follow-up

Owner: Browser Use

Decision: `../decisions/2026-08-04-001-browser-use-binding-authority-decision-log.md`

## Objective

Build the first complete signed Item Binding path: explicit human approval,
immutable private receipt storage, presence-free verification, exact live vault
revalidation, portable Runbook references, and immediate revocation.

## Current PR boundary

PR #303 must fail closed before this plan begins:

- First-bind discovery never returns an approved Item Binding.
- One or many eligible live items return `binding-approval-required` with the
  `request-binding-selection-grant` continuation.
- Zero eligible items remains `revoked-binding`.
- Candidate hints rank only.
- No blocked first-bind path retrieves or delivers a credential field.

## Owners

| Concern | Owner |
| --- | --- |
| Domain vocabulary | `skills/browser-use/CONTEXT.md` |
| Receipt and projection contracts | `skills/browser-use/src/browser-use-auth-bindings.ts` |
| Approval signatures and presence | `skills/browser-use/src/browser-use-auth-approval.ts` plus `runtime/browser-use-security/` |
| Private paths and atomic catalog storage | new plain binding-catalog module under `skills/browser-use/src/` |
| Live vault projection | `skills/browser-use/src/browser-use-op.ts` |
| Preparation and use-time verification | `skills/browser-use/src/browser-use-auth-provider.ts` |
| Runbook schema and compilation | `skills/browser-use/src/browser-use-runbook-model.ts` |
| CLI discovery and continuations | `skills/browser-use/src/command-contract.ts` plus `skills/browser-use/src/browser-use.ts` |
| Durable run pin | `skills/browser-use/src/browser-use-run-model.ts` |

## Required contracts

- R1. A Binding Reference is portable and contains no vault identity.
- R2. Resolution key includes service, auth context, environment, profile, and
  Binding Reference.
- R3. A complete receipt revision binds exact vault/item identity, exact
  origins, exact credential methods, issuance facts, verifier key, signature,
  and predecessor revision.
- R4. ApprovalBroker signs one complete immutable revision after explicit user
  presence.
- R5. Requests and live vault evidence never mint authority.
- R6. Ephemeral approval display may include item title, masked username, and
  exact origin; none enters stdout, stderr, logs, run state, receipts, or the
  catalog.
- R7. Catalog writes use private modes, exact-shape validation, atomic replace,
  directory sync, and one fenced active-selection update.
- R8. One active revision exists per resolution key; ambiguous or corrupt
  selection fails closed.
- R9. Runtime verifies signature, verifier identity, active revision, and
  revocation before using live evidence.
- R10. Live exact-item reads must still prove vault/item identity, active state,
  every approved origin, and every approved method.
- R11. Added live origins or methods do not expand authority.
- R12. Missing approved origins or methods invalidate the projection.
- R13. Replacement, expansion, or method change creates a complete new signed
  revision; revocation leaves no usable active revision.
- R14. Run state pins binding id and revision, but every confidential delivery
  rechecks active/unrevoked authority.
- R15. An inactive pinned revision blocks and restarts auth preparation before
  any later field delivery.
- R16. Runbook confidential fills carry `binding_ref` and explicit
  `credential_field`; suffix parsing is removed after migration.
- R17. A missing binding returns one typed continuation and never invokes user
  presence inside ordinary execution.
- R18. Exact item-field projection proves OTP availability; category membership
  never authorizes OTP.
- R19. Import Candidates remain proposals and preserve redacted provenance.
- R20. No secret value, auth-bearing URL, username, title, or vault metadata is
  persisted outside its declared custody boundary.

## Sequence

### U0. Keep PR #303 fail closed

- Land `binding-approval-required` across model, match policy, provider,
  transaction phases, CLI continuation mapping, and tests.
- Prove one and many eligible candidates block before credential retrieval.

### U1. Prove one signed receipt vertical slice

- Define the complete receipt and Verified Item Binding projection.
- Extend the native signing protocol for one exact create receipt.
- Verify signature and bound facts without the broker present.
- Use production signer plus deterministic test verifier as the two real
  adapters; no wider abstraction.

### U2. Add the private Binding Catalog

- Add admitted state-root paths, exact record validation, immutable revision
  storage, active selection, revocation, crash recovery, and inspection.
- Prove interrupted stage, active-selection drift, symlink escape, competing
  writers, and corrupt receipt refusal.

### U3. Add explicit approval commands

- Replace ambiguity-only selection with `auth binding create` over redacted
  candidates.
- Send human-readable descriptors only to the local approval display.
- Add replace, expand-origin, add-method, revoke, list, and show surfaces with
  discovery/help/parser/runtime anti-drift proof.

### U4. Resolve portable Runbook references

- Add `binding_ref` and `credential_field` to the complete-document schema.
- Migrate safe suffix-based records mechanically; refuse ambiguous slugs.
- Resolve through service, auth context, environment, and profile.

### U5. Enforce use-time authority

- Derive Verified Item Binding from receipt plus exact live item read.
- Pin the resolved revision to run state.
- Recheck active revision and live evidence before every confidential field.
- Block replacement, revocation, or drift before later delivery.

### U6. Close evidence and journey gates

- Replace category-constant OTP evidence with exact item-field proof.
- Add unit, process-boundary, hermetic custody, crash-resume, replacement,
  revocation, and no-egress tests.
- Run full Browser Use and Browser Use Security CI gates.

## Exit

- A fresh binding needs one explicit human approval.
- Later valid uses need no human presence.
- Request labels and live discovery cannot manufacture authority.
- Revocation stops the next confidential delivery.
- Runbooks remain portable and contain no local vault identity.
- The Daily Driver Acceptance Proof names the signed binding journey and its
  remaining live gate truthfully.
