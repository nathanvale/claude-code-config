# Runbook: V2 contract coverage review loop

**Seam:** Every current major v1 Issue-to-PR section and helper command group has
a planned v2 destination (or explicit removal reason), and every U1 prose-only
invariant or deterministic probe target has preservation evidence recorded in
`runbooks/issue-to-pr-v2/references/regression-matrix.md`. The loop converges to
zero unmapped contracts across multiple sweeps.

**Ledger:** [v2-contract-coverage-ledger.md](v2-contract-coverage-ledger.md)

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Files in scope

- `runbooks/issue-to-pr/issue-to-pr.md` *(read-only source — frozen until U7)*
- `runbooks/issue-to-pr/README.md` *(read-only source — frozen until U7)*
- `runbooks/issue-to-pr/issue-N-ledger.template.md` *(read-only source)*
- `runbooks/issue-to-pr/decompose.ts` *(read-only source — runtime contract values harvested here)*
- `runbooks/issue-to-pr-v2/references/regression-matrix.md` *(the only contract artifact the loop writes to; ledger bookkeeping stays in this seam's ledger)*

## Suggested reviewer personas

- `compound-engineering:ce-correctness-reviewer` — does each matrix row accurately reflect v1 behavior?
- `compound-engineering:ce-coherence-reviewer` — are mappings internally consistent across rows? Any duplicate or contradicting destinations?
- `compound-engineering:ce-scope-guardian-reviewer` — any v1 invariant out of scope per issue #48 but still load-bearing? Any matrix row that drifts beyond the v2 plan?
- `compound-engineering:ce-project-standards-reviewer` — does the matrix follow the convention defined in issue #48's plan (line-map rows, manual v1/v2 scenario rows, deterministic probe targets)?

## ADR guardrails

- **ADR 0001 (Orchestration / mechanic split)** — matrix rows must respect the boundary: prose-only invariants map to references/prose; deterministic mechanics map to `cli.ts` / module code. A row that maps a prose invariant into code (or a deterministic check into prose) violates this.
- **ADR 0002 (Public contract rule)** — matrix entries must not propose changes to the public hot runbook (`issue-to-pr.md`) during this seam. Public cutover is U7's job.
- **Issue #48 scope boundary** — the matrix owns the U1 behavior-preservation map only: major current sections and helper command groups from `issue-to-pr.md`, `README.md`, `issue-N-ledger.template.md`, and `decompose.ts`; the named prose-only invariants in U1; and the deterministic probe targets. It must not propose public hot-runbook changes before U7.

## Scoped audit prompt

````
Review `runbooks/issue-to-pr-v2/references/regression-matrix.md` against the four
v1 sources listed in Files in scope.

For the U1 line-map:

1. Does the matrix contain a row for every current major section in
   `issue-to-pr.md`, `README.md`, and `issue-N-ledger.template.md`, plus every
   `decompose.ts` command group?
2. Does each line-map row point to the v1 source range, name one or more
   qualified v2 destinations (reference path, template path, `cli.ts` command
   family, module family, hot router section, README index, or explicit removal
   reason), and name the owner unit that lands it? If a row has multiple
   destinations, each destination must say which slice of the v1 source it owns.
3. Are removals explicit and justified, instead of hidden as omitted rows?

For each prose-only invariant listed in issue #48 U1 (Local Law Read Order,
Mechanic Discipline, Public Contract Rule, Domain Language Rule, Preflight
Checklist, Probe Catalog, final-review patch decision tree, smallest contract
patch heuristic, mechanical-diff fallback, broad-reviewer fallback, selector
precedence, host-readiness vs infrastructure-failure boundary):

4. Does the matrix contain a row that names the invariant, points to where it
   lives in v1, and names its v2 destination (reference path, template path,
   `cli.ts` command, or explicit removal reason)?
5. Does the row include manual v1 and v2 scenario evidence — short sentences
   describing the behavior that proves the invariant survived the move?
6. Is the v2 destination internally consistent with other rows? (No two
   invariants colliding into the same destination without explanation; no
   destination that contradicts ADR 0001/0002.)

For each deterministic probe target (installed reference/template presence,
`runbook_version` mismatch, `cli.ts state --json`, `cli.ts diagnose --json`,
startup route behavior):

7. Does the matrix have a row mapping the probe to either a current helper
   behavior in `decompose.ts` or a planned `cli.ts` command family?

Severity:
- P0: a load-bearing section, helper mode, invariant, or probe has no v2 home
  and no removal reason
- P1: a row exists but the v2 destination is wrong, inconsistent, missing its
  owner unit, or
  ADR-contradicting
- P2: a row exists but is missing scenario evidence, probe mapping, source range,
  or clear line-map coverage
- P3: minor formatting, ordering, or wording issues

Return findings with stable kebab-case signatures so dedupe works across
sweeps (e.g. `selector-precedence-no-v2-home`,
`mechanic-discipline-destination-contradicts-adr-0001`).

Do NOT propose edits to v1 `issue-to-pr.md`, v1 `README.md`, the v1 ledger
template, or v1 `decompose.ts`. The only contract artifact the seam may edit is
the shadow v2 regression matrix; the seam ledger is for bookkeeping only.
````

## Closing a finding without fixing it

Seam-specific close reasons (in addition to the shared `out-of-scope-for-this-issue`, `ADR-contradicts-<id>`, and `fails-graduation-test`):

- `not-in-u1-scope` — the invariant is real but issue #48 U1 does not own its mapping (e.g. it's a U5 packet-boundary concern). Note the future seam in the resolution.
- `removed-by-design` — the invariant is intentionally dropped in v2; the matrix row records the removal reason instead of a destination.
- `subsumed-by-<row-id>` — the invariant is folded into another matrix row; resolution names the canonical row.

## /loop fallback

```
/loop 5 Follow docs/runbooks/issue-to-pr-v2-refactor/v2-contract-coverage.md.
Re-read the runbook and v2-contract-coverage-ledger.md at the start of every
turn. Echo the full ledger status table inline at the end of every turn.
```
