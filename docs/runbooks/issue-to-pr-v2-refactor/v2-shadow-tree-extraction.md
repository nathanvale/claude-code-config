# Runbook: V2 shadow tree extraction review loop

**Seam:** The Issue-to-PR v2 shadow tree under `runbooks/issue-to-pr-v2/references/`
and `runbooks/issue-to-pr-v2/templates/` exists, preserves the v1 prose-contract
invariants (role boundaries, read triggers, no-XML-wrapping, no-v1-dependency),
and lands at paths the U1 regression matrix already names. The loop converges to
zero new findings across multiple sweeps.

**Ledger:** [v2-shadow-tree-extraction-ledger.md](v2-shadow-tree-extraction-ledger.md)

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Files in scope

**Writable (v2 shadow tree — this seam's contract surface):**

References (one prose contract per file, per the U1 regression matrix
destinations):

- `runbooks/issue-to-pr-v2/references/builder-dispatch.md`
- `runbooks/issue-to-pr-v2/references/findings-and-validators.md`
- `runbooks/issue-to-pr-v2/references/ledger-and-helper.md`
- `runbooks/issue-to-pr-v2/references/host-adapters.md`
- `runbooks/issue-to-pr-v2/references/stage-1-pick-issue.md`
- `runbooks/issue-to-pr-v2/references/stage-2-plan.md`
- `runbooks/issue-to-pr-v2/references/stage-3-decompose.md`
- `runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md`
- `runbooks/issue-to-pr-v2/references/stage-5-final-review.md`
- `runbooks/issue-to-pr-v2/references/stage-6-ship.md`

Templates (executor-filled artifacts for the prose contracts above):

- `runbooks/issue-to-pr-v2/templates/builder-work-packet.md`
- `runbooks/issue-to-pr-v2/templates/proposer-envelope.md`
- `runbooks/issue-to-pr-v2/templates/validator-envelope.md`
- `runbooks/issue-to-pr-v2/templates/patch-proposal.md`
- `runbooks/issue-to-pr-v2/templates/ce-plan-addendum.md`

(These are the landed names. The U1 regression matrix is the authoritative
source for which v1 prose lands at which shadow destination.)

**Read-only (v1 sources — frozen until U7):**

- `runbooks/issue-to-pr/issue-to-pr.md`
- `runbooks/issue-to-pr/README.md`
- `runbooks/issue-to-pr/issue-N-ledger.template.md`
- `runbooks/issue-to-pr/decompose.ts`

**Read-only (U1 anchor — this seam consumes it; U1 owns writes):**

- `runbooks/issue-to-pr-v2/references/regression-matrix.md`

## Suggested reviewer personas

- `compound-engineering:ce-correctness-reviewer` — does each extracted reference/template accurately preserve the v1 prose-contract it was lifted from?
- `compound-engineering:ce-coherence-reviewer` — are role boundaries (Builder writes, Proposer read-only-returns-batches, Validator gates, Stage 5 read-only) consistent across all five templates and reference roles? Any leakage where Proposer commits or Stage 5 mutates?
- `compound-engineering:ce-scope-guardian-reviewer` — does the v1 hot runbook (`runbooks/issue-to-pr/`) remain free of imports/links into the shadow tree? Any shadow file that prematurely depends on or alters v1?
- `compound-engineering:ce-project-standards-reviewer` — are read triggers visible? Are YAML/JSON/Markdown examples free of XML-style wrapping tags? Does file layout match the structure declared in issue #50?

## ADR guardrails

- **ADR 0001 (Orchestration / mechanic split)** — prose contracts (role policies, stage descriptions, read triggers) live in `references/`; templates filled in by an executor live in `templates/`. A reference that embeds executable mechanics, or a template that hard-codes a prose-only invariant rather than referencing it, violates this.
- **ADR 0002 (Public contract rule)** — no shadow file may be imported, linked, or referenced by the v1 hot runbook (`runbooks/issue-to-pr/`) during this seam. Public cutover is U7's job.
- **Issue #50 scope boundary** — this seam owns the shadow extraction only. It does not converge the regression matrix (U1 owns that), does not perform the public cutover (U7 owns that), and does not touch later-unit concerns (U5 packet boundaries, U6 ledger versioning, U9 regression probes).
- **No-XML-wrapping rule** — helper-validated YAML, JSON envelopes, and Markdown examples must appear as fenced code blocks with language hints, not wrapped in `<xml-tag>` style. Violations are P1.
- **Role-policy invariants (from issue #50)** — Proposer is read-only and returns candidate batch contracts only; Stage 5 is read-only; final-review remediation routes through Proposer + confirmed Stage 4 patch batches. Any template or reference that contradicts these is P0.
- **No-Ralph-Gate-vocabulary** (from `docs/brainstorms/2026-05-21-issue-to-pr-builder-sub-agent-requirements.md`) — convergence is owned by the existing P0/P1-gated Validator persona loop. Templates and references must not introduce "Ralph Gate" terminology.

## Scoped audit prompt

````text
Review the v2 shadow tree under `runbooks/issue-to-pr-v2/references/` and
`runbooks/issue-to-pr-v2/templates/` against the v1 sources in
`runbooks/issue-to-pr/` and the U1 regression matrix at
`runbooks/issue-to-pr-v2/references/regression-matrix.md`.

Audit items:

1. Does each `references/` file (stage, role-policy, helper-ledger, host-adapter,
   regression) exist with a v1 source anchor and a visible read trigger that
   names when an executor should open it?
2. Does each `templates/` file (Builder, Proposer, Validator, patch-proposal,
   ce-plan) exist with role boundaries that match the v1 prose: Builder writes,
   Proposer is read-only and returns candidate batch contracts only, Validator
   gates with P0/P1, Stage 5 is read-only, final-review routes back through
   Proposer + confirmed Stage 4 patch batches?
3. Is the Proposer template free of edit/commit/append verbs targeting Builder
   attempts? (Proposer returns; it does not mutate.)
4. Are helper-validated YAML examples, JSON envelopes, and Markdown examples
   rendered as fenced code blocks with language hints — never wrapped in
   XML-style tags?
5. Are read triggers visible to a reader of the consuming template (named in
   the template body or in a See-also section), rather than hidden as inline
   prose only?
6. Does the v1 hot runbook (`runbooks/issue-to-pr/`) remain free of imports,
   links, or references into the shadow tree? Any v1 file that now points at
   `issue-to-pr-v2/` is a violation.
7. Does each shadow file's destination match the U1 regression matrix row that
   owns its v1 source? Any drift between matrix destination and actual landing
   path is P1.
8. Are role-boundary invariants from issue #50 preserved verbatim where the v1
   source stated them, rather than paraphrased into a weaker form?
9. Do `references/` files avoid embedding executable mechanics, and do
   `templates/` files avoid hard-coding prose-only invariants instead of
   referencing them? (ADR 0001 split.)
10. Is "Ralph Gate" vocabulary absent? Convergence is owned by the existing
    P0/P1-gated Validator persona loop; templates and references must not
    introduce competing terminology.

Severity:
- P0: role-boundary violation, missing required file, v1 hot runbook now
  depends on shadow tree, or Ralph Gate vocabulary introduced
- P1: XML-style wrapping present, destination drifts from U1 matrix, read
  trigger not visible, or ADR 0001 split violated
- P2: v1 source anchor missing, paraphrasing weakens an invariant, or
  helper/template example formatting is inconsistent
- P3: minor formatting, ordering, or wording issues

Return findings with stable kebab-case signatures so dedupe works across
sweeps (e.g. `proposer-template-edits-builder-attempt`,
`patch-proposal-yaml-xml-wrapped`, `host-adapter-reference-no-read-trigger`).

Do NOT propose edits to v1 `runbooks/issue-to-pr/` files. Do NOT propose
edits to `runbooks/issue-to-pr-v2/references/regression-matrix.md` (U1 owns
it; this seam consumes it read-only). The only contract artifacts this seam
may edit are the shadow `references/` and `templates/` files listed in
Files in scope; the seam ledger is for bookkeeping only.
````

## Closing a finding without fixing it

Seam-specific close reasons (in addition to the shared `out-of-scope-for-this-issue`, `ADR-contradicts-<id>`, and `fails-graduation-test`):

- `not-in-u2-scope` — finding is real but belongs to U5/U6/U7/U9. Note the future seam in the resolution.
- `owned-by-u1-matrix` — finding is a matrix-coverage issue, not a shadow-tree issue. Route back to U1.
- `deferred-to-u7-cutover` — finding is about v1 → v2 wiring; correct fix lands in U7.

## /loop fallback

```text
/loop 5 Follow docs/runbooks/issue-to-pr-v2-refactor/v2-shadow-tree-extraction.md.
Re-read the runbook and v2-shadow-tree-extraction-ledger.md at the start of every
turn. Echo the full ledger status table inline at the end of every turn.
```
