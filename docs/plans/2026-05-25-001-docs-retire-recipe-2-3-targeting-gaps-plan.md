---
title: "docs: retire first-run-gotchas recipe 2.3 and close its targeting gaps"
type: docs
status: active
created: 2026-05-25
issue: 87
plan_depth: lightweight
---

# docs: retire first-run-gotchas recipe 2.3 (blocked-digests-stale) and close its targeting gaps

## Summary

Issue #87 is the deferred sibling of PR #86 / issue #83, which retired
first-run-gotchas recipes 2.1, 2.2, and 2.4. Recipe 2.3
(`blocked-digests-stale`) was intentionally out of scope for #83 because it
sits on a *different retirement track*: its retire-when bar names
`ledger-and-helper.md`, not `SKILL.md`. Two distinct targeting gaps remain, on
two different files:

- **Gap A (`ledger-and-helper.md`):** recipe 2.3's own retire-when bar is unmet
  because the "Stage-transition digest recheck" paragraph does not yet link to
  recipe 2.3 for the recovery sequence.
- **Gap B (`SKILL.md`):** the shared `<route_catalog>` bullet covers both
  `blocked-batch-contract-stale` and `blocked-digests-stale` but names only
  recipe 2.2, leaving `blocked-digests-stale` with no per-recipe pointer.

Once both links exist, recipe 2.3's retire-when bar is converted to a
retirement record using the same "Retired 2026-05, not deleted" treatment #83
applied to its siblings. The `ledger-and-helper.md` link satisfies the literal
retire-when bar; the `SKILL.md` link closes the companion route-catalog
targeting gap. The recipe body stays in place as the recovery reference those
named links point at.

Docs-only. No `.ts` change (ADR 0002 keeps the CLI read-only). The governing
verification is `contract-drift.test.ts` (109 tests), which reads the real docs
and checks them against the live contract; `route.test.ts` (77 tests) must also
stay green. Use the Bun MCP runner for the two focused test files, falling back
to the repo CLI only if the runner is unavailable.

---

## Problem Frame

Three coordinated edits across three markdown files, with a strict ordering
constraint: the two links (Gap A and Gap B) must both be in place *before*
recipe 2.3's retire-when bar is converted to a retirement record, because the
retirement record names both completed targeting gaps. Writing the retirement
record before the links exist would make the record's claim false and would
create the exact cross-file contradiction AC6 forbids.

The work mirrors a known-good precedent: recipes 2.1, 2.2, and 2.4 were retired
in #83 with an established phrasing pattern. This plan reuses that pattern
verbatim in structure, differing only in which file satisfies the bar (Gap A
adds the `ledger-and-helper.md` link that 2.1/2.2/2.4 did not need, because
those three were `SKILL.md`-only tracks).

---

## Requirements Traceability

| AC | Requirement | Implementation Unit |
| --- | --- | --- |
| AC1 | `ledger-and-helper.md` digest-recheck paragraph links recipe 2.3 by name for the recovery sequence | U1 |
| AC2 | `SKILL.md` route_catalog bullet links recipe 2.3 by name (alongside existing 2.2 link) | U2 |
| AC3 | Recipe 2.3 retire-when bar converted to a retirement record (body retained) | U3 |
| AC4 | No change to `lib/route.ts`, `requiredReferenceIdsFor`, or CLI runtime behavior | U1, U2, U3 (invariant) |
| AC5 | `route.test.ts` (77) and `contract-drift.test.ts` (109) stay green | U3 verification (final gate over cumulative diff) |
| AC6 | No contradiction across the three edited surfaces after the change | U3 (ordering + consistency invariant) |

---

## High-Level Technical Design

The ordering constraint is the only non-obvious part. *This illustrates the
intended approach and is directional guidance for review, not implementation
specification.*

```
U1 (add ledger-and-helper.md -> 2.3 link)  ─┐
                                            ├─> U3 (retire 2.3 bar; record both targeting gaps closed)
U2 (add SKILL.md -> 2.3 link)              ─┘
```

U1 and U2 are independent (different files, no shared lines) and may be done in
either order, but U3 depends on both: the retirement record's text asserts that
both links exist, so both must land first. In the issue-to-pr batch model this
is naturally one batch (all three edits are coordinated and the consistency
check spans all three files), with U3's edit applied last within the batch.

---

## Implementation Units

### U1. Add the `ledger-and-helper.md` recovery-sequence link to recipe 2.3

**Goal:** The "Stage-transition digest recheck" paragraph in
`ledger-and-helper.md` links to `first-run-gotchas.md` recipe 2.3
(`blocked-digests-stale`) by name, for the recovery sequence (AC1).

**Requirements:** AC1, AC4.

**Dependencies:** none.

**Files:**
- `runbooks/issue-to-pr-v2/references/ledger-and-helper.md`

**Approach:** The "Stage-transition digest recheck (v1 L315-326)" paragraph
(around lines 91-98) describes *what* to do on digest drift (recompute,
fail-stop, return to Stage 3 confirmation). It is the *what*; recipe 2.3 is the
symptom-first CLI evidence recipe (the *how to confirm*). Add a sentence at the
end of that paragraph that links to recipe 2.3 by name and frames it as the
recovery-sequence evidence recipe, not a bare see-also. Use a relative markdown
link to `first-run-gotchas.md` with the recipe named (e.g.,
`[first-run-gotchas.md](first-run-gotchas.md) recipe 2.3
(blocked-digests-stale)`), matching the link style already used elsewhere in
this file (it links to `first-run-gotchas.md` in its See also section). Do not
alter the existing recheck instructions; only append the recovery-sequence
pointer.

**Patterns to follow:** The existing See-also link to `first-run-gotchas.md` at
the bottom of `ledger-and-helper.md`; the issue body's instruction that the
link is "for the recovery sequence" (the recheck block is the what; recipe 2.3
is the evidence recipe).

**Test scenarios:** `Test expectation: none -- docs-only edit; the behavioral
gate is contract-drift.test.ts, exercised at U3 verification over the cumulative
diff.` (No standalone test for this unit; AC5 covers the suite.)

**Verification:** The digest-recheck paragraph contains a named reference to
recipe 2.3 (`blocked-digests-stale`) framed for the recovery sequence; no other
prose in the paragraph changed; `git diff` for this file shows only an addition.

---

### U2. Add the `SKILL.md` route_catalog named link to recipe 2.3

**Goal:** The `<route_catalog>` `blocked-batch-contract-stale` and
`blocked-digests-stale` bullet in `skills/issue-to-pr/SKILL.md` links to
`first-run-gotchas.md` recipe 2.3 by name, in addition to the existing recipe
2.2 link (AC2).

**Requirements:** AC2, AC4.

**Dependencies:** none.

**Files:**
- `skills/issue-to-pr/SKILL.md`

**Approach:** The shared bullet (lines 283-286) currently reads: "…return to
Stage 3 recompute and user confirmation. See `first-run-gotchas.md` recipe 2.2
(`blocked-batch-contract-stale`) for the symptom-first evidence recipe." Extend
the trailing sentence so each route names its own recipe: recipe 2.2 for
`blocked-batch-contract-stale` and recipe 2.3 for `blocked-digests-stale`. Match
the per-route phrasing pattern the 2.1 and 2.4 bullets already use elsewhere in
`<route_catalog>` and `<pre_route_gates>` (recipe number plus the route id in
backticks). Keep both routes on the shared bullet; do not split the bullet into
two.

**Patterns to follow:** The 2.1 named link in the
`blocked-acceptance-criteria-stale` bullet (lines 277-281) and the 2.4 named
link in the version-skew gate; both name the recipe number and the route id.

**Test scenarios:** `Test expectation: none -- docs-only edit; the behavioral
gate is contract-drift.test.ts, exercised at U3 verification over the cumulative
diff.`

**Verification:** The shared route_catalog bullet names recipe 2.3 for
`blocked-digests-stale` while retaining the recipe 2.2 link for
`blocked-batch-contract-stale`; `git diff` for `SKILL.md` shows only the bullet
text changed.

---

### U3. Retire recipe 2.3's retire-when bar and verify no contradiction

**Goal:** Recipe 2.3's retire-when bar in `first-run-gotchas.md` is converted to
a retirement record (marked retired per the entry-governance contract, recipe
body retained), recording that the U1 `ledger-and-helper.md` link satisfies the
literal retire-when bar and the U2 `SKILL.md` link closes the companion
route-catalog targeting gap (AC3), with no contradiction across the three edited
surfaces (AC6) and both test suites green (AC5).

**Requirements:** AC3, AC4, AC5, AC6.

**Dependencies:** U1, U2 (the retirement record names both links; both must land
first).

**Files:**
- `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`

**Approach:** Convert recipe 2.3's retire-when bar (lines 385-388) using the
exact pattern #83 applied to 2.1, 2.2, and 2.4: keep the original "**Retire
when**" sentence, then append a "**Retired 2026-05 (issue #87):**" sentence
recording what now closes the open follow-up, closing with "The recipe content
is kept as the recovery reference the named link points at; this entry is
retired from the 'open follow-up' sense, not deleted." The retirement sentence
must reference both completed targeting gaps while distinguishing their roles:
the `ledger-and-helper.md` digest-recheck recovery-sequence link satisfies the
literal retire-when bar, and the `SKILL.md` route_catalog named link closes the
companion per-route targeting gap. Keep the **Owner:** line and the full recipe
body (Symptom / Command / JSON fields / What the fields prove / Recovery / Model
note) unchanged. After editing, run the two test suites and re-read all three
edited surfaces to confirm AC6 (no contradiction): the SKILL.md bullet, the
ledger-and-helper digest-recheck paragraph, and the recipe 2.3 retirement record
must agree on what links exist and what each link closes.

**Execution note:** Apply this unit's edit last within the batch — after U1 and
U2 are in the working tree — so the retirement record's claims about both links
are true at the moment it is written.

**Patterns to follow:** Recipe 2.1 retirement record (lines 297-306), 2.2
(336-344), 2.4 (425-433); the entry-governance contract (lines 56-64) requiring
each entry to end with Owner and Retire when lines.

**Test scenarios:**
- `route.test.ts` stays green at 77/77 (AC5) via the Bun MCP runner's focused
  file test — no route contract touched.
- `contract-drift.test.ts` stays green at 109/109 (AC5) via the Bun MCP runner's
  focused file test — the governing suite reads the real docs against the live
  contract; it must accept the new links and the retired-bar phrasing.
- Cross-surface consistency (AC6): after the edit, the SKILL.md route_catalog
  bullet, the ledger-and-helper digest-recheck paragraph, and the recipe 2.3
  retirement record contain no contradictory claims about which links exist or
  what each link closes.

**Verification:** Recipe 2.3 ends with an Owner line and a retirement record in
the #83 pattern naming both the `ledger-and-helper.md` and `SKILL.md` links; the
recipe body is unchanged; the Bun MCP runner passes both focused test files
(77/77, 109/109); a re-read of the three surfaces shows mutual agreement.

---

## Scope Boundaries

**In scope:**
- The three coordinated edits to `ledger-and-helper.md`, `skills/issue-to-pr/SKILL.md`, and `first-run-gotchas.md` (recipe 2.3 retire bar).
- Verifying `route.test.ts` and `contract-drift.test.ts` stay green.

**Out of scope (true non-goals):**
- Any `.ts` change — `lib/route.ts`, `requiredReferenceIdsFor`, CLI runtime behavior (AC4 forbids it).
- Recipe 2.5's retire-when bar (install-presence) — a separate un-retired entry, not named by this issue.
- Deleting recipe 2.3's body — the retirement is "not deleted; body retained."

### Deferred to Follow-Up Work
- Install-sync of `~/.claude/skills/issue-to-pr/SKILL.md` (the installed copy is a non-symlinked copy, currently identical to the repo copy). The repo copy is source of truth for the PR; syncing the installed copy is an `install.sh` concern outside this issue's ACs and is not required for the PR to be correct.

---

## Risks

- **Ordering risk:** writing U3's retirement record before U1/U2 land would make its claim false and trip AC6. Mitigated by U3's explicit dependency and execution note (apply last).
- **Phrasing drift risk:** deviating from the #83 retirement pattern could create a contract-drift.test.ts failure if that suite pins the retirement phrasing. Mitigated by copying the sibling pattern verbatim in structure and running the governing suite at U3.

---

## Structured Implementation Units

Machine-readable batch contract for the issue-to-pr decompose helper. One batch
per implementation unit. U3 depends on U1 and U2 because its retirement record
names both links.

```yaml
id: u1-ledger-helper-link
name: Add the ledger-and-helper.md recovery-sequence link to recipe 2.3
goal: The "Stage-transition digest recheck" paragraph in ledger-and-helper.md links to first-run-gotchas.md recipe 2.3 (blocked-digests-stale) by name, for the recovery sequence.
files:
  - runbooks/issue-to-pr-v2/references/ledger-and-helper.md
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 1 holds: the digest-recheck paragraph in ledger-and-helper.md names recipe 2.3 (blocked-digests-stale) and frames it for the recovery sequence, not a bare see-also."
ac_mapping:
  - 1
rationale: null
```

```yaml
id: u2-skill-route-catalog-link
name: Add the SKILL.md route_catalog named link to recipe 2.3
goal: The route_catalog blocked-batch-contract-stale and blocked-digests-stale bullet in SKILL.md links to first-run-gotchas.md recipe 2.3 by name, alongside the existing recipe 2.2 link.
files:
  - skills/issue-to-pr/SKILL.md
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 2 holds: the shared route_catalog bullet names recipe 2.3 for blocked-digests-stale while retaining the recipe 2.2 link for blocked-batch-contract-stale."
ac_mapping:
  - 2
rationale: null
```

```yaml
id: u3-retire-recipe-2-3
name: Retire recipe 2.3 retire-when bar and verify no contradiction
goal: Recipe 2.3's retire-when bar in first-run-gotchas.md is retired (marked retired per the entry-governance contract, recipe body retained), recording that the ledger-and-helper.md link satisfies the literal retire-when bar and the SKILL.md link closes the companion route-catalog targeting gap, with no contradiction across the three edited surfaces and both test suites green.
files:
  - runbooks/issue-to-pr-v2/references/first-run-gotchas.md
depends_on:
  - u1-ledger-helper-link
  - u2-skill-route-catalog-link
execution_mode: change_first
acceptance_tests:
  - "AC 3 holds: recipe 2.3 ends with an Owner line and a retirement record in the #83 pattern naming both the ledger-and-helper.md and SKILL.md links; the recipe body is retained."
  - "AC 4 holds: no change to lib/route.ts, requiredReferenceIdsFor, or CLI runtime behavior across the cumulative diff."
  - "AC 5 holds: route.test.ts stays green (77/77) and contract-drift.test.ts stays green (109/109)."
  - "AC 6 holds: the SKILL.md route_catalog bullet, the ledger-and-helper digest-recheck paragraph, and the recipe 2.3 retirement record contain no contradictory claims about which links exist or what each link closes."
ac_mapping:
  - 3
  - 4
  - 5
  - 6
rationale: "merge: ACs 4 (no .ts change), 5 (suites green), and 6 (cross-surface consistency) are invariants verified over the cumulative diff at the final coordinated edit; they have no source change of their own and are mapped onto the unit that lands last and runs the governing suite."
```
