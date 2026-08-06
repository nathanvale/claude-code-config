---
status: accepted
date: 2026-07-26
---

# Candidate import proposes; live vault evidence binds

The Auth U3 candidate-import Interface accepts legacy-derived Import Candidates and re-runs the exact fresh-discovery match/selection policy against the current token-scoped vault. No field of a candidate ever carries authority. One rule resolves every import question: legacy data proposes, live vault evidence binds, and humans resolve ambiguity through signed one-use grants.

Six sub-decisions fix the rule's edges:

1. **Item hints rank, never authorize.** A legacy pointer naming one of several matching Login items pre-ranks the redacted selection list; ambiguity still requires the signed one-use human selection. No tie is broken mechanically by legacy trust.
2. **Origins are re-derived live.** Origins fresh discovery derives from the current item come along free; legacy-only origins (subdomain and IdP aliases) surface as ranked proposals with provenance and require explicit re-approval. Import never silently widens the authorized origin set.
3. **Secret-positive candidates are refused, not salvaged.** Any candidate field matching the secret-shape patterns returns a typed `secret-positive-candidate` rejection per candidate. Platform migration owns stripping to a clean projection and re-submitting; the Interface never handles secret bytes.
4. **Bindings are independent per service and auth context.** Two services sharing one Login item hold two bindings whose `item_id` coincides. Revocation, repair, and origin consent never cross services; a shared item is a fact, not a link.
5. **`auth_context` is a closed code-owned vocabulary**, starting at exactly one value (`interactive-login`). Legacy free-form context prose is redacted display provenance and is never mapped automatically; new contexts are added by code change when a real portal needs one.
6. **The legacy vault field is display-only provenance.** Vault mismatch is not an error; when the item is absent from the token-scoped vault, the existing `missing-item` continuation carries the legacy vault name as a repair hint, turning the vault consolidation chore into a guided per-service loop.

Terminology: **Item Binding** is the canonical name for the approved live link; **Auth Pointer** is its legacy-era predecessor, and surviving pointers are Import Candidates.

## Pressure Gate

- Pressure source: the plan requires import to "pass the same match/selection policy" while the entire legacy corpus predates the Browser Automation vault, the current consent policy, and the secret-embedding prohibition.
- Seam: one Interface whose accept shape is untrusted proposal and whose emit shape is the same binding fresh discovery produces, or a typed continuation.
- Deletion test: deleting the rule forces per-field trust judgments across ~30 services and two eras of consent policy; any legacy field granted authority becomes a second permission system.
- Locality: match/selection policy exists once; import adds no second pipeline.
- Leverage: Platform U3 gets a deterministic disposition per candidate without auth trusting anything it did not re-derive.

## Considered Options

- Auto-bind on unique legacy hints: frictionless migration, but the hint was consented under the old weaker policy and becomes authority — a stale pointer silently binds the wrong item.
- Import legacy origin lists verbatim: a stale alias could authorize credential delivery to an origin the live item no longer supports.
- Strip secrets inside the Interface: puts secret bytes through a public contract surface and silently launders which legacy files held plaintext credentials.
- Shared binding records for shared items: revocation cascades and origin consent leaks across services.
- Slugging legacy context prose into cache keys: unbounded input, unverifiable mapping, duplicate keys for one flow.
- Hard refusal on vault mismatch: rejects every legacy pointer including already-consolidated ones, since the mismatch lives in the dead hint, not live reality.

## Consequences

- Migration friction concentrates exactly where legacy diverges from live vault truth; deterministic single matches import with no prompt.
- The Interface's public surface is secret-free by construction; contamination in the legacy corpus is surfaced per file for cleanup.
- The Browser Automation vault consolidation happens as guided `missing-item` repairs, service by service, not as a migration precondition.
- Widening the `auth_context` vocabulary or letting any import field bind mechanically requires revisiting this decision.
