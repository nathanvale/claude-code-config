---
title: Signed authority for Browser Use Item Bindings
slug: browser-use-binding-authority
type: decision-log
status: accepted
date: "2026-08-04"
timezone: Australia/Melbourne
owner: browser-use
---

# Signed authority for Browser Use Item Bindings

Browser Use will never mint credential authority by copying request
`service_id` or `auth_context` values onto an origin-matched vault item. A
human-approved, ApprovalBroker-signed Binding Approval Receipt owns that
authority; exact live Vault Item Evidence can only constrain or invalidate it.

## Decision

- Treat `service_id` and `auth_context` as authorization dimensions.
- Require one explicit ApprovalBroker ceremony to create a binding.
- Create one immutable complete receipt revision per approved change.
- Scope a receipt to service, auth context, environment, profile, exact vault
  item, exact origins, and exact credential methods.
- Store receipts and active revision selection in a private local Binding
  Catalog.
- Derive a Verified Item Binding from the active receipt plus exact live vault
  evidence before every confidential delivery.
- Stop further delivery immediately when the receipt is replaced, revoked,
  invalid, or contradicted by live evidence.
- Let Runbooks name a portable Binding Reference and an explicit credential
  field. Never encode local vault identity or credential fields in the
  reference name.
- Block a missing binding with an explicit approval continuation. Never
  auto-bind a single discovery candidate or surprise-prompt inside execution.
- Permit human-readable item title and masked username only as ephemeral local
  approval display. Persist only opaque item identity and signed facts.

## Considered alternatives

- Exact-origin discovery plus request labels was rejected because it lets a
  request manufacture service and auth-context identity.
- Vault-authored service/context metadata was rejected as a vendor-specific
  second permission system.
- Source-controlled item mappings were rejected because local vault identity
  and revocation do not belong in portable Runbook source.
- Per-run approval was rejected because unattended login needs presence-free
  use after an approved creation ceremony.
- Standing automatic selection was rejected because it authorizes future
  credential choices rather than one exact item.
- Delta-folded or mutable binding records were rejected in favor of one
  complete inspectable signed revision.

## PR #303 boundary

PR #303 provides a secure front-door base, not the Binding Catalog. Until the
catalog and receipt verifier exist, first-bind discovery returns
`binding-approval-required` with redacted candidates and performs zero
credential retrieval or delivery. Existing approved-binding revalidation stays
fail-closed. The implementation plan owns the complete product path.

## Consequences

- Live vault discovery ranks candidates; it never authorizes them.
- One vault item may support independent receipts for different service,
  profile, or auth-context scopes.
- New origins or methods require a new signed revision.
- Runs may pin a revision for continuity, but pinning never overrides current
  revocation or active-revision checks.
