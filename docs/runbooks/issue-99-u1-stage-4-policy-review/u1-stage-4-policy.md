# Runbook: U1 Stage 4 dispatch policy review

**Seam:** Review the U1 implementation on `feat/issue-99-stage-4-dispatch-policy`
against the U1 spec in
[docs/plans/2026-05-21-001-feat-builder-work-packet-dispatch-plan.md](../../plans/2026-05-21-001-feat-builder-work-packet-dispatch-plan.md)
(section "U1. Refresh Builder Role Boundaries and Stage 4 Policy"). U1 rewrites
the Stage 4 dispatch policy so Builder stays the isolated mechanic for
proof-bearing and repair work, bounded `change_first` may run Orchestrator-inline,
and the full Validator wave applies to every committed attempt. The seam drives
every cross-document inconsistency, drift, or host-specific leak to a fixed or
closed ledger row.

## Central risk

U1 is prose spread across 8 files (2 ADRs, the active skill router, v1 source
anchors, v2 references). The risk is **policy drift**: the same Stage 4 rule
stated four times in four places, with one place subtly disagreeing. A reader
who lands on the disagreeing document gets the wrong contract. The review must
verify that R1, R5, and R8 hold *identically* across all 8 files, not just in any
single file.

## Ledgers, plans, and the implementation under review

- **Under review:** the committed + working-tree state of the 8 files on this
  branch.
- **Source of truth:** the U1 section of the plan (R1/R5/R8, the approach
  bullets, the test scenarios, and the verification criteria).
- **Bounding ADRs:** ADR 0001 (isolation policy), ADR 0002 (prose orchestrates,
  CLI emits facts), ADR 0003 (always-on wave floor).

## Files in scope

**Writable (this seam's contract surface - the 8 U1 plan files):**

- `docs/adr/0001-stage-4-context-isolation.md`
- `docs/adr/0003-stage-4-keeps-always-on-validator-wave.md`
- `skills/issue-to-pr/SKILL.md`
- `runbooks/issue-to-pr/README.md`
- `runbooks/issue-to-pr/issue-to-pr.md`
- `runbooks/issue-to-pr-v2/issue-to-pr.md`
- `runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md`
- `runbooks/issue-to-pr-v2/references/builder-dispatch.md`

**Read-only (frozen - out of U1's scope):**

- `runbooks/issue-to-pr-v2/references/host-adapters.md` (U3 surface)
- `runbooks/issue-to-pr-v2/references/findings-and-validators.md` (U6 surface)
- `runbooks/issue-to-pr-v2/stage-4-policy-drift.test.ts` (new, untracked - not U1)
- `settings.json` (unrelated branch change)
- `docs/adr/0002-runbooks-and-skills-use-prose-as-orchestrator.md` (bounding, not edited by U1)
- All `runbooks/issue-to-pr-v2/lib/*.ts`, `templates/*.md`, and the U1 plan itself
- Every other file in the repo

## What this seam is NOT - explicit anti-list

- **No policy redesign.** U1's policy decisions are settled in the plan's
  "Resolved During Planning" list. This seam aligns wording to that policy; it
  does not relitigate whether inline `change_first` should exist, whether
  readiness gates inline work, or whether the wave is reduced for inline.
- **No edits outside the 8 files.** If a finding requires touching
  `host-adapters.md`, `findings-and-validators.md`, a `lib/*.ts`, the drift test,
  or `settings.json`, that belongs to U3/U5/U6 or is out of scope - close the row
  with the appropriate reason and flag it.
- **No new files.** This is a prose-alignment seam.
- **No git history rewrites.**
- **No host-specific primitive names** introduced into shared prose (no Claude
  Task-tool wiring, no Codex-specific spawn instructions).

## Matrix structure

Each review pass MUST check, across all 8 files:

1. **R1 - Builder-required modes.** Every file that mentions mode-to-path routing
   agrees: `tdd` and `proof_first` require Builder dispatch; `change_first` is
   inline-eligible only while bounded.
2. **R1 - inline eligibility bounds.** The bound list is stated consistently
   wherever it appears: small (at most two touched files), low-risk,
   non-behavioural, non-public-contract, non-governance, no broad discovery, no
   heavy Orchestrator context load, and not the third consecutive inline attempt
   without a user-confirmed exception.
3. **R1 - repair routing.** Every file agrees: an open P0/P1 after any committed
   attempt routes to Builder-only repair, never inline.
4. **R5 - wave floor.** Every file agrees the full always-on Validator wave runs
   on every committed implementation attempt (Builder envelope OR
   Orchestrator-inline), with no reduced wave for inline.
5. **R8 - cross-document agreement.** ADR 0001, ADR 0003, SKILL.md, v1 anchors,
   and v2 references tell the same story; no two disagree.
6. **R8 - host neutrality.** No Claude-specific or Codex-specific agent primitive
   names appear in the shared policy prose.
7. **Internal integrity.** No dangling cross-references or stale anchors
   introduced by the U1 edits within the 8 files.

## Suggested reviewer personas

Always-on:

- `compound-engineering:ce-correctness-reviewer` - the policy as written is
  internally consistent; the mode->path logic, eligibility bounds, and
  repair-routing rule have no contradictions or gaps.
- `compound-engineering:ce-project-standards-reviewer` - host-neutrality, naming
  conventions, no Claude/Codex primitive leak, ADR frontmatter and structure
  intact.
- `compound-engineering:ce-maintainability-reviewer` - the same claim is not
  restated in subtly different words across files in a way that will drift again;
  cross-references resolve.
- `compound-engineering:ce-coherence-reviewer` - contradictions between sections
  and across the 8 documents, terminology drift, ambiguity where two readers
  would diverge.
- `compound-engineering:ce-scope-guardian-reviewer` - the diff respects the
  anti-list (no edits outside the 8 files, no policy redesign, no new files).

## ADR guardrails

- **ADR 0001 (Stage 4 context isolation).** This is one of the files under
  review. The seam verifies the rewrite is self-consistent and that the other 7
  files match it.
- **ADR 0002 (prose orchestrates; CLI emits facts).** U1 must not push dispatch
  or ledger-mutation logic into prose that belongs to helpers, nor describe
  `cli.ts` as deciding dispatch. Bounding only; do not edit.
- **ADR 0003 (always-on wave floor).** Also under review. Verify the extension
  from "committed Builder envelope" to "committed implementation attempt" is
  consistent with how the wave floor is described in the router and references.

## Scoped audit prompt

```text
Review the U1 implementation on branch feat/issue-99-stage-4-dispatch-policy
against the U1 spec in
docs/plans/2026-05-21-001-feat-builder-work-packet-dispatch-plan.md (section
"U1. Refresh Builder Role Boundaries and Stage 4 Policy"). U1 is a prose/contract
unit. The 8 files under review are:

- docs/adr/0001-stage-4-context-isolation.md
- docs/adr/0003-stage-4-keeps-always-on-validator-wave.md
- skills/issue-to-pr/SKILL.md
- runbooks/issue-to-pr/README.md
- runbooks/issue-to-pr/issue-to-pr.md
- runbooks/issue-to-pr-v2/issue-to-pr.md
- runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md
- runbooks/issue-to-pr-v2/references/builder-dispatch.md

Audit items:

1. R1 (Builder-required modes): Do all 8 files agree that `tdd` and `proof_first`
   require Builder dispatch, and that `change_first` is inline-eligible only
   while bounded? Quote any file that disagrees or omits the rule where it should
   state it.
2. R1 (inline eligibility bounds): Is the eligibility bound list stated
   consistently wherever it appears (at most two touched files, low-risk,
   non-behavioural, non-public-contract, non-governance, no broad discovery, no
   heavy Orchestrator context load, no third consecutive inline attempt without a
   user-confirmed exception)? Flag any file that lists a different or partial set
   of bounds.
3. R1 (repair routing): Do all files agree that an open P0/P1 after any committed
   attempt routes to Builder-only repair, never inline?
4. R5 (wave floor): Do all files agree the full always-on Validator wave runs on
   every committed implementation attempt - Builder envelope OR
   Orchestrator-inline - with no reduced wave for the inline path?
5. R8 (cross-document agreement): Read ADR 0001 and ADR 0003 as the source of
   truth, then check the skill router, v1 anchors, and v2 references against
   them. Report any place where two documents state the same rule differently
   enough that a reader could reach a different conclusion.
6. R8 (host neutrality): Does any shared policy prose introduce a Claude-specific
   or Codex-specific agent primitive name (e.g. naming a specific spawn tool)
   where it should use the host-neutral "Builder dispatch" / "host readiness"
   vocabulary?
7. Internal integrity: Did the U1 edits introduce any dangling cross-reference,
   stale anchor, or broken section link within the 8 files?
8. Spec fidelity: Does the implementation satisfy U1's three acceptance tests and
   its two verification criteria (a reviewer can answer which modes require
   Builder and when change_first loses inline eligibility from Stage 4 prose
   alone; search confirms no active Stage 4 control-plane text claims every
   implementation attempt is a Builder attempt)?

Severity:
- P0: a file states a Stage 4 policy rule that directly contradicts ADR 0001 or
  ADR 0003 (wrong modes require Builder, inline allowed where it must not be, a
  reduced wave for inline, inline repair of an open P0/P1); the active control
  plane still claims every implementation attempt is a Builder attempt.
- P1: a host-specific primitive name leaks into shared policy prose; the inline
  eligibility bound list materially disagrees between two files; a verification
  criterion from U1 cannot be answered from the prose alone.
- P2: the same rule is restated in inconsistent wording that risks future drift
  but does not currently mislead; a dangling cross-reference or stale anchor.
- P3: minor wording, formatting, or ordering nits.

Return findings with stable kebab-case signatures (e.g.
`router-omits-inline-eligibility-bounds`,
`adr-0003-router-wave-floor-disagree`,
`host-specific-primitive-in-shared-prose`,
`v1-anchor-still-says-builder-only-wave`).

Do NOT propose edits to any file outside the 8 listed. Do NOT propose redesigning
the U1 policy - the policy decisions are settled in the plan's "Resolved During
Planning" list; this review aligns wording to that policy and verifies
cross-document agreement.
```

## Closing a finding without fixing it

Seam-specific close reasons:

- `out-of-u1-scope` - finding requires touching a file outside the 8 U1 files
  (e.g. `host-adapters.md`, `findings-and-validators.md`, the drift test,
  `settings.json`, a `lib/*.ts`). Belongs to U3/U5/U6 or is unrelated; file it
  and flag it.
- `settled-policy-decision` - finding relitigates a decision already resolved in
  the plan's "Resolved During Planning" list.
- `belongs-to-later-unit` - finding is real but its fix lands in a downstream
  unit (U2-U7) per the plan's unit boundaries.

## Stop condition

Stop when ALL hold:

1. R1, R5, and R8 verified consistent across all 8 in-scope files.
2. A reviewer can answer, from Stage 4 prose alone, which modes require Builder
   and when `change_first` loses inline eligibility.
3. Targeted search confirms no active Stage 4 control-plane text claims every
   implementation attempt is a Builder attempt.
4. No host-specific primitive name appears in shared policy prose.
5. Two consecutive independent `/ce-code-review` passes each return zero new
   findings (see the README Convergence protocol).
6. Every ledger row in `u1-stage-4-policy-ledger.md` is `fixed` or `closed`.

## /loop fallback

```text
/loop 5 Follow docs/runbooks/issue-99-u1-stage-4-policy-review/u1-stage-4-policy.md.
Re-read the runbook and u1-stage-4-policy-ledger.md at the start of every turn.
Echo the full ledger status table inline at the end of every turn.
```

Convergence is the README's Convergence protocol: two consecutive independent
clean passes from different angles, not zero-open after one pass.
