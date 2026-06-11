# Archived glossary terms

Removed from root `CONTEXT.md` during the 2026-06-11 domain split. Retained here for provenance; not active vocabulary.

**Final metadata checkpoint contamination**:
A Stage 6 hygiene failure where changed, staged, untracked, or committed paths exceed the final metadata checkpoint allowlist. It is fixed by cleaning the ship-tail state and rerunning Stage 6, not by routing through product review.
_Avoid_: final-review finding, residual finding, product diff issue

**Workflow Learning upsert outcome**:
The runtime-emitted result of applying a Registry candidate to the Workflow Learnings registry. Final learning-summary counts come from helper facts, not prose inference.
_Avoid_: learning count, scan count, inferred summary, registry status

**Ledger template scaffold**:
Legacy committed template that showed the per-issue ledger starting shape before runtime rendering owned initial ledger creation.
_Avoid_: initial ledger render, generated schema doc, prose schema, contract owner

_Reasons:_ Final metadata checkpoint contamination — survives only in `_Avoid_` lines. Workflow Learning upsert outcome — no live consumers. Ledger template scaffold — retired per ADR-0005.
