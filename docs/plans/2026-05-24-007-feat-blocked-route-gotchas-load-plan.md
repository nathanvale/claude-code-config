---
title: "feat: Deterministically load first-run-gotchas.md on blocked routes"
type: feat
status: active
created: 2026-05-24
issue: 80
plan_depth: standard
---

# feat: Deterministically load first-run-gotchas.md on blocked routes

## Problem Frame

An agent following `skills/issue-to-pr/SKILL.md`'s `<orchestration_loop>`
mechanically executes step 7 ("Load every reference listed in
`data.required_reference_ids`"). The v2 CLI never emits
`first-run-gotchas.md` in that list by design (`requiredReferenceIdsFor`
in `runbooks/issue-to-pr-v2/lib/route.ts` returns a fixed set per route
and deliberately excludes the gotchas guide). So an autonomous driver (a
`/goal` loop or a Codex thread) **never loads the recovery guide on a
blocked route**.

The current trigger for the guide is "operator judgment" / "when a state
is confusing" — a discretionary cue a human scanning `SKILL.md` can act
on, but not a deterministic condition an autonomous agent can evaluate.
The concrete consequence: on `blocked-acceptance-criteria-stale`, recipe
2.1 distinguishes two mutually exclusive proof paths (digest drift vs.
the `ac_confirmation_status` field gate). Without the guide loaded, an
autonomous agent must infer the correct proof path unassisted —
recoverable, but more likely to produce an incomplete surface message
that needs human intervention.

The fix is a single deterministic load step in the control plane: when
`data.route_id` starts with `blocked-`, also load
`first-run-gotchas.md`. This is a `SKILL.md`-only change. It must not
touch `route.ts`, `requiredReferenceIdsFor`, or any CLI runtime behavior
(read-only CLI contract, ADR 0002).

**Origin:** GitHub issue #80, deferred from PR #79 / issue #78
multi-agent code review (agent-native reviewer finding #4).

---

## Scope Boundaries

### In scope

- Add a deterministic load step to `<orchestration_loop>` in
  `skills/issue-to-pr/SKILL.md`: on a `blocked-` prefixed `route_id`,
  load `runbooks/issue-to-pr-v2/references/first-run-gotchas.md` in
  addition to `data.required_reference_ids`.
- Reconcile the `<reference_loading_policy>` framing (table row + the
  "discretionary exception" note) so "deterministic on blocked routes"
  and "absent from `data.required_reference_ids` by design" coexist
  without contradiction.
- Reconcile the `<route_catalog>` blocked-route prose so it agrees with
  the new deterministic step rather than reading as purely
  discretionary.
- Qualify the `first-run-gotchas.md` read-trigger (lines 3-8) so it
  reflects the D3 split: the deterministic load applies to `blocked-*`
  routes; the discretionary "open this guide when recovery is not
  obvious" cue applies to the non-blocked cryptic-state path. This
  reconciles the guide's own opening with the new orchestration behavior
  (AC #3).
- Re-evaluate retirement triggers 2.1, 2.2, 2.4 in
  `first-run-gotchas.md` and **document that they remain open** (the
  blanket guide load does not satisfy the per-route named-link bar each
  trigger names). The retire-when bar text is left **verbatim**; a short
  re-evaluation **annotation** is added after each of the three
  retire-when lines so a future reader of the guide can see the
  re-evaluation happened and why the trigger stayed open.

### Deferred to Follow-Up Work

- Adding per-route **named links** (route_catalog bullets pointing to
  recipe 2.1 / 2.2 by name, version-skew gate pointing to recipe 2.4 by
  name). That is the change that would *satisfy and retire* triggers
  2.1/2.2/2.4, but it exceeds issue #80's stated orchestration-loop fix.
  Tracked as the existing retirement triggers in `first-run-gotchas.md`.
- Any change to `route.ts`, `requiredReferenceIdsFor`, or the
  `route.test.ts` pinned per-route mapping.

### Out of scope (non-goals)

- Making `first-run-gotchas.md` a CLI-required reference. This is
  explicitly forbidden: it would break the pinned `route.test.ts`
  per-route mapping (lines 901-946) and contradict the intentional
  design recorded at `SKILL.md` lines 199-204 and ADR 0002.
- Editing the recovery recipes' content (commands, JSON fields, model
  notes). Only the retire-when re-evaluation is in scope, and that
  concludes "no change".

### Scope note: the read-trigger and annotation edits

Issue #80's AC #3 names reconciliation of the `<reference_loading_policy>`
"discretionary framing" inside `SKILL.md`, and the issue body says "the
discretionary label in `<reference_loading_policy>` can remain for human
clarity." The two edits this plan makes to `first-run-gotchas.md` itself
(the read-trigger qualification in U4 step 2 and the retire-when
annotations in U4 step 1) are therefore a **deliberate expansion** of the
issue's literally-named surface, justified by AC #3's "no contradiction"
intent: after U1's deterministic load lands, the guide's own read-trigger
would otherwise contradict the new behavior, and the AC #4 re-evaluation
would otherwise be invisible to the guide's readers. The PR description
should call out both guide edits explicitly so a reviewer checking the PR
against the issue sees them as a reasoned scope call, not silent creep.

---

## Key Technical Decisions

### D1. The deterministic load is orchestration prose, not a CLI contract change

The load step lives in `<orchestration_loop>` as a prose rule the agent
evaluates against the observed `route_id`. It does **not** go into
`requiredReferenceIdsFor`.

**Rationale.** ADR 0002 (`docs/adr/0002-runbooks-and-skills-use-prose-as-orchestrator.md`):
"Judgment goes in prose. Determinism goes behind a CLI or script.
Runtime contracts go in code." A blocked-route recovery overlay is
operator-judgment scaffolding, not a runtime contract. Pushing it into
`required_reference_ids` would (a) break the pinned `route.test.ts`
mapping and (b) invert ADR 0002 by moving a discretionary recovery aid
into the runtime contract. The CLI stays read-only: it reports
`route_id`; the control-plane prose decides the load.

### D2. "Deterministic on blocked, absent from required_reference_ids by design" is stated explicitly

The reconciled `<reference_loading_policy>` note must not just soften
the word "discretionary" — it must name the precise distinction:
`first-run-gotchas.md` is **deterministically loaded by this skill's
loop on `blocked-*` routes**, while **remaining absent from
`data.required_reference_ids` by design** (route.ts does not emit it;
that is intentional, not drift to file).

**Rationale.** The current note (lines 199-204) asserts the guide is
"discretionary ... not a route.ts drift to file." If we only add a load
step elsewhere and leave this note unchanged, the two sections
contradict each other — which is the exact failure AC #3 guards against.
Stating both halves of the distinction in one place removes the
contradiction without weakening the route.ts-drift guard.

### D3. The "discretionary" cue survives for the non-blocked path

The `<route_catalog>` already has a softer trigger for "valid-but-cryptic
first-run states" that are not blocked routes (e.g. the Part 1 sharp
edges like null digest timing). That discretionary cue stays. Only the
**blocked-route** path becomes deterministic.

**Rationale.** `first-run-gotchas.md` Part 1 covers valid non-blocked
states (digest timing, list-typed fields). A blanket "always load on any
confusing state" would over-trigger; "deterministic on `blocked-`,
discretionary on cryptic-but-valid" matches the guide's actual two-part
structure (Part 1 sharp edges, Part 2 blocked recipes).

### D4. Retirement triggers 2.1/2.2/2.4 remain open, re-evaluation recorded in the guide

The triggers retire when `SKILL.md` adds a **per-route named link** to
each specific recipe. The exact retirement target differs by trigger and
must be described accurately when recording the re-evaluation:

- **2.1** retires when the `<route_catalog>`
  `blocked-acceptance-criteria-stale` bullet links to recipe 2.1 by name.
- **2.2** retires when the `<route_catalog>`
  `blocked-batch-contract-stale` bullet links to recipe 2.2 by name.
- **2.4** retires when the **`<pre_route_gates>`** version-skew entry
  links to recipe 2.4 by name (it currently links only to
  `ledger-and-helper.md`). This is the pre-route gate block, **not** a
  `<route_catalog>` bullet.

The deterministic load is a different mechanism: it loads the whole guide
but does not point the agent to *which* recipe applies. Loading is
improved; per-recipe targeting is not. So none of the three triggers are
satisfied, and their retire-when bar text is left **verbatim**.

**On the "supersede" reading.** Issue #80's scope note says the
deterministic load "may satisfy or supersede" the triggers. This decision
addresses both. *Satisfy* is refuted above (the load is not a per-route
named link). *Supersede* is the stronger claim that, once the guide is
deterministically loaded on every blocked route, the named link's
*loading* purpose is already served, so the trigger is moot. We reject
supersede too, for one reason: the named-link bar is a proxy for
**per-recipe targeting**, not just for getting the guide in front of the
agent. After the deterministic load, an agent on
`blocked-acceptance-criteria-stale` still does not know whether recipe
2.1's digest-drift path or its `ac_confirmation_status` field-gate path
applies; the named link is what would close that gap. The load improves
*loading*; the triggers track *targeting*, which is still open. If a
future maintainer decides targeting is not worth the named links, the
correct move is to retire the triggers deliberately at that point, not to
treat this change as having retired them.

**Rationale.** AC #4 requires re-evaluation and update "if the
deterministic load satisfies them." The faithful conclusion is that it
does not satisfy (or supersede) them. Re-evaluation is satisfied by
recording the reasoning **where the guide's own readers can find it** —
an annotation after each retire-when line — not only in this plan and the
PR. A reworded or removed retire-when bar would overstate what this
change delivers; a silent plan-only record would leave a future reader of
the guide unable to see that the question was already asked and answered.

---

## System-Wide Impact

This change touches the control-plane document that both human operators
and autonomous drivers (`/goal`, Codex loops) read to route the
Issue-to-PR workflow. The affected surfaces that must stay internally
consistent after the edit:

- `skills/issue-to-pr/SKILL.md` `<orchestration_loop>` (new step)
- `skills/issue-to-pr/SKILL.md` `<reference_loading_policy>` (table row
  + discretionary note)
- `skills/issue-to-pr/SKILL.md` `<route_catalog>` (blocked-route prose)
- `runbooks/issue-to-pr-v2/references/first-run-gotchas.md` (read-trigger
  reconciliation + retire-when re-evaluation annotations on 2.1/2.2/2.4)

A **parity-audit seam** (`docs/runbooks/issue-to-pr-skill-parity-audit/reference-loading-and-routing.md`)
reached two-clean-pass convergence and this edit re-opens it. The seam's
contract: SKILL.md must not inline runtime constants (the `ROUTE_IDS`
tuple, `blocking_gates` union) and references stay one level deep. The
new step must read as "skill loop loads the guide," never as
"first-run-gotchas.md is now CLI-required."

**Propagation note:** `~/.claude/skills` is a directory symlink to the
repo's `skills/`, and `SKILL.md` is hand-authored (not rendered from
`prompt-fragments/`). Editing the canonical file is immediately live at
the installed path — no render, copy, or `install.sh` step is required.

---

## Implementation Units

### U1. Add the deterministic blocked-route load step to `<orchestration_loop>`

**Goal.** Make an autonomous agent load `first-run-gotchas.md` on every
`blocked-` route, deterministically, without a CLI change.

**Requirements.** AC #1 (deterministic load on `blocked-*` routes), AC #2
(no `route.ts` / `requiredReferenceIdsFor` / CLI change).

**Dependencies.** None.

**Files.**
- `skills/issue-to-pr/SKILL.md` (`<orchestration_loop>`, lines 111-139)

**Approach.** Insert a new step after step 7 (the
`data.required_reference_ids` load) — the issue suggests numbering it
"7b" or an equivalent step that keeps the existing numbered sequence
coherent. The step's behavior: *when `data.route_id` begins with
`blocked-`, also load `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`
in addition to the route's `required_reference_ids`.* Phrase it so it is
unmistakably a control-plane load layered on top of the CLI's required
set, not a claim that the CLI emits the guide. Keep the existing step 6
(route from `data.route_id`) untouched; this new step reads the same
field for a prefix test. Do not renumber in a way that breaks references
to step numbers elsewhere in the doc — verify no other section cites
"step 8/9/10" by number, and if it does, preserve those references.

**Patterns to follow.** The existing numbered-step prose style in
`<orchestration_loop>` (imperative, one action per step). The blocked-route
ID list in `route.ts` lines 54-59 confirms every blocked route shares the
`blocked-` prefix, so a prefix test is exhaustive and clean.

**Test scenarios.** Test expectation: none — this is a control-plane
prose edit with no executable behavior. Verification is grep-visible
consistency (U4) and the unchanged route tests staying green (U4).

**Verification.** The new step is present, reads as a skill-loop load
(not a CLI emission), references the guide by its one-level-deep path,
and does not alter step 6's routing semantics.

### U2. Reconcile `<reference_loading_policy>` so the deterministic load and the route.ts-drift guard coexist

**Goal.** Remove the contradiction between "discretionary exception" and
the new deterministic blocked-route load.

**Requirements.** AC #3 (discretionary framing reconciled, no
contradiction).

**Dependencies.** U1 (the policy note must describe the behavior U1
introduces).

**Files.**
- `skills/issue-to-pr/SKILL.md` (`<reference_loading_policy>`, lines
  168-206 — specifically the table row at line 182 and the note at lines
  199-204)

**Approach.** Per D2, rewrite the discretionary note to state both
halves of the distinction explicitly: the guide is deterministically
loaded by the skill loop on `blocked-*` routes **and** remains absent
from `data.required_reference_ids` by design (route.ts does not emit it;
intentional, not drift). Update the table row (line 182) so its
"discretionary" label is qualified — the blocked-route load is
deterministic, the non-blocked cryptic-state load remains discretionary
(D3). Keep the route.ts-drift guard sentence intact in substance: adding
the guide to `requiredReferenceIdsFor` is still wrong. Do not inline any
route tuple or schema.

**Patterns to follow.** The parity-audit seam's `false-positive:
ADR-0002` close-out reason — a runtime constant correctly staying out of
the skill. The reconciled note should read as confirming, not
weakening, that the guide stays out of the CLI contract.

**Test scenarios.** Test expectation: none — prose reconciliation.
Verification is grep-visible consistency (U4): the words
"deterministic"/"deterministically" and "absent from
`data.required_reference_ids`" (or equivalent) both appear in the note,
and "discretionary" no longer stands unqualified against the blocked
path.

**Verification.** Reading `<reference_loading_policy>` and
`<orchestration_loop>` back to back yields no contradiction: blocked
routes load the guide deterministically; the guide is still not
CLI-emitted; non-blocked cryptic states remain discretionary.

### U3. Reconcile the `<route_catalog>` blocked-route prose

**Goal.** Make the blocked-route paragraph in `<route_catalog>` agree
with the new deterministic step instead of implying the load is purely
optional.

**Requirements.** AC #3 (no contradiction across sections).

**Dependencies.** U1.

**Files.**
- `skills/issue-to-pr/SKILL.md` (`<route_catalog>`, blocked-route note at
  lines 235-238)

**Approach.** The existing note (lines 235-238) says "When a blocked
route or a valid-but-cryptic first-run state needs a symptom-first CLI
evidence recipe ... load first-run-gotchas.md." Tighten the blocked-route
half so it reflects the deterministic load (the loop loads it on blocked
routes), while preserving the discretionary cue for the
"valid-but-cryptic first-run state" half (D3). This is the surface that
already half-states the behavior; make it consistent with U1's wording
rather than introducing a second, differently-worded rule.

**Patterns to follow.** Keep the catalog's operator-facing voice. Do not
duplicate the orchestration-loop step verbatim — cross-consistency, not
copy-paste, so the two surfaces can't drift on re-wording.

**Test scenarios.** Test expectation: none — prose reconciliation.
Verification via U4 grep consistency.

**Verification.** The `<route_catalog>` blocked-route prose, the
`<orchestration_loop>` step, and the `<reference_loading_policy>` note
all describe the same behavior: deterministic load on blocked routes,
discretionary on non-blocked cryptic states.

### U4. Annotate retirement triggers, reconcile the read-trigger, and verify whole-change consistency

**Goal.** Satisfy AC #4 by recording the trigger re-evaluation **in the
guide** (a discoverable annotation, bar text verbatim), reconcile the
guide's read-trigger with the new deterministic load, and run the
grep-visible consistency + green-test verification for the whole change.

**Requirements.** AC #4 (triggers re-evaluated and updated if satisfied),
AC #3 (no cross-document contradiction, now including the guide's
read-trigger), plus final verification of AC #1-#3.

**Dependencies.** U1, U2, U3.

**Files.**
- `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`
  (read-trigger framing at lines 3-8; retire-when lines for 2.1 at ~294,
  2.2 at ~328, 2.4 at ~413)

**Approach.**
1. **Retire-when re-evaluation annotation (D4, F2).** The three triggers
   retire on a per-route **named link** in `SKILL.md` (2.1 and 2.2 in
   `<route_catalog>`; **2.4 in `<pre_route_gates>`**, the version-skew
   entry — see D4 for the exact targets). The deterministic load is a
   different mechanism (whole-guide load, not per-recipe targeting), so it
   neither satisfies nor supersedes them. Leave each retire-when bar text
   **verbatim**. Append a short re-evaluation **annotation as a
   parenthetical continuation of each existing "Retire when" line** (not
   as a new line after it), e.g.: *"Retire when [bar text verbatim].
   (Re-evaluated 2026-05 against the deterministic blocked-route load,
   issue #80: still open — that load improves loading, not per-recipe
   targeting.)"* Keeping the annotation on the Retire-when line preserves
   the guide's entry-governance contract (`first-run-gotchas.md` lines
   56-57: "Each entry ends with **Owner** and **Retire when** lines") —
   the Retire-when line remains the entry's terminal element, so no
   governance-contract edit is needed. This makes the re-evaluation
   discoverable by the guide's own readers (not only in this plan and the
   PR) without breaking the structural invariant the guide uses to police
   itself.
2. **Read-trigger reconciliation (lines 3-8, F3).** The guide currently
   opens "open this guide when ... a blocked route whose recovery is not
   obvious from the route id alone" — a discretionary, reader's-choice
   framing. After U1 makes the load deterministic on every `blocked-*`
   route, that clause contradicts the new behavior (the loop now loads the
   guide unconditionally on blocked routes; the operator does not decide).
   Qualify the read-trigger so it matches the D3 split: the loop loads the
   guide automatically on `blocked-*` routes, and the "open this when
   recovery is not obvious" judgment cue applies to the **non-blocked
   cryptic-state** path (the Part 1 sharp edges). This is a required edit,
   not a discretionary one — the prior "no edit is the default" framing is
   superseded by this decision.
3. **Consistency + test verification** (the change-wide gate):
   - `rg` that every `references/*` path linked from the edited SKILL.md
     sections resolves to a real file (one level deep, no broken links).
   - `rg` for the reconciled vocabulary across the three SKILL.md
     sections **and the guide's read-trigger** to confirm all four
     surfaces agree (no unqualified "discretionary" against the blocked
     path; "deterministic" present where U1/U2/U3 require it; the guide's
     read-trigger no longer frames blocked-route loading as a reader's
     choice).
   - Confirm no route tuple / `blocking_gates` union / schema got inlined
     into SKILL.md.
   - Confirm no fenced YAML/JSON was wrapped in XML tags.
   - Confirm the guide's entry-governance contract still holds: each of
     2.1/2.2/2.4 still ends with its **Owner** and **Retire when** lines,
     with the re-evaluation folded into the Retire-when line as a
     parenthetical (not a trailing new line). The governance sentence at
     `first-run-gotchas.md` lines 56-57 is left unchanged.
   - Run biome lint/format on the edited markdown (expect clean).
   - Run the runbook test suite (expect green; no `.ts` changed — the
     pinned `route.test.ts` mapping must be untouched).

**Patterns to follow.** The verification recipe from the control-plane
refactor plan (`docs/plans/2026-05-24-003-refactor-issue-to-pr-skill-control-plane-plan.md`,
lines 359-367): `rg` linked reference paths, confirm no schema/tuple
duplication, confirm no XML-wrapped fenced data.

**Test scenarios.** Test expectation: none for the doc edits themselves.
The *guarding* tests are the existing `runbooks/issue-to-pr-v2/lib/route.test.ts`
suite — they must stay green to prove AC #2 (no CLI contract change). Run
them as a regression gate, do not add new ones.

**Verification.**
- AC #1: `<orchestration_loop>` deterministically loads the guide on
  `blocked-*` routes (U1 present and correctly worded).
- AC #2: `git diff` touches no `.ts` file; `route.test.ts` green;
  `requiredReferenceIdsFor` unchanged.
- AC #3: the three SKILL.md sections **and the guide's read-trigger** read
  consistently (grep + manual read).
- AC #4: triggers re-evaluated; conclusion (remain open) recorded **in the
  guide as an annotation** plus the plan and PR; retire-when bar text
  unchanged verbatim.

---

## Structured batch contract

The four narrative Implementation Units above decompose into two
`change_first` (docs-only) batches for the Stage 4 Builder loop. U1, U2,
and U3 all edit the single file `skills/issue-to-pr/SKILL.md` in
coordinated, inseparable sections (the orchestration-loop step plus the
two reconciliations it forces), so they merge into one batch per the
addendum's same-file merge rule. U4 edits a different file
(`first-run-gotchas.md`) and runs the whole-change verification, so it is
a second batch that depends on the first.

```yaml
id: batch-1-skill-reconcile
name: Reconcile SKILL.md control-plane sections (U1+U2+U3)
goal: SKILL.md deterministically loads first-run-gotchas.md on blocked-* routes with no contradiction across orchestration-loop, reference-loading-policy, and route-catalog, and no CLI/route.ts change.
files:
  - skills/issue-to-pr/SKILL.md
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 1 holds: <orchestration_loop> has a step that loads runbooks/issue-to-pr-v2/references/first-run-gotchas.md whenever data.route_id begins with blocked-, worded as a skill-loop load layered on the CLI required set."
  - "AC 2 holds: git diff touches no .ts file; route.test.ts stays green; requiredReferenceIdsFor unchanged."
  - "AC 3 holds: <reference_loading_policy> and <route_catalog> read consistently with the new step (deterministic on blocked routes, discretionary on non-blocked cryptic states); no unqualified discretionary against the blocked path; the guide stays absent from data.required_reference_ids by design."
ac_mapping:
  - 1
  - 2
  - 3
rationale: "merge: U1/U2/U3 are inseparable coordinated edits to the single file skills/issue-to-pr/SKILL.md (orchestration-loop step plus the two reconciliations it forces); splitting would create three sequential single-file batches with overlapping ownership."
```

```yaml
id: batch-2-guide-and-verify
name: Reconcile first-run-gotchas.md and verify whole change (U4)
goal: The affected first-run-gotchas.md retirement triggers (2.1, 2.2, 2.4) are re-evaluated and the guide's read-trigger is reconciled, then whole-change consistency and green tests are verified.
files:
  - runbooks/issue-to-pr-v2/references/first-run-gotchas.md
depends_on:
  - batch-1-skill-reconcile
execution_mode: change_first
acceptance_tests:
  - "AC 4 holds: triggers 2.1/2.2/2.4 re-evaluated against the deterministic blocked-route load; conclusion (remain open) recorded as an in-guide annotation folded into each Retire-when line; bar text left verbatim."
  - "AC 3 holds (guide half): the guide's read-trigger (lines 3-8) is qualified to the D3 split so it no longer frames blocked-route loading as a reader's choice, matching the new deterministic load."
ac_mapping:
  - 4
rationale: "split: U4 edits a different file (first-run-gotchas.md) from batch-1 and owns the whole-change verification gate; depends on batch-1 so the guide reconciliation matches the landed SKILL.md behavior."
```

---

## Requirements Traceability

| Acceptance criterion (issue #80) | Covered by |
| --- | --- |
| AC #1 — `<orchestration_loop>` deterministically loads `first-run-gotchas.md` on `blocked-*` | U1 |
| AC #2 — no change to `route.ts` / `requiredReferenceIdsFor` / CLI runtime | U1 (decision), U4 (verification: green `route.test.ts`, no `.ts` diff) |
| AC #3 — discretionary framing reconciled, no contradiction | U2, U3, U4 (read-trigger reconciliation) |
| AC #4 — triggers 2.1/2.2/2.4 re-evaluated and updated if satisfied | U4 (D4: re-evaluated against satisfy + supersede, remain open, recorded as in-guide annotations) |

---

## Verification Strategy

This is a docs-only control-plane reconciliation. There is no executable
behavior to unit-test; the verification is grep-visible consistency plus
keeping the existing CLI tests green as the AC #2 regression gate
(`execution_mode: change_first` — no red test would add signal beyond the
grep-visible checks, matching the precedent in
`docs/plans/2026-05-24-006-fix-issue-to-pr-runbook-heal-merge-guard-plan.md`).

Concrete checks (run in U4):

1. `rg -n 'references/first-run-gotchas\.md' skills/issue-to-pr/SKILL.md`
   — confirms the new load step and reconciled prose reference the guide
   by its correct one-level-deep path.
2. Manual read of `<orchestration_loop>`, `<reference_loading_policy>`,
   `<route_catalog>` back to back — confirms a single coherent story.
3. `git diff --name-only` — confirms only
   `skills/issue-to-pr/SKILL.md` and
   `runbooks/issue-to-pr-v2/references/first-run-gotchas.md` (the
   read-trigger reconciliation + the three retire-when annotations)
   changed; no `.ts` files.
4. biome lint/format on the changed markdown (via `biome_lintCheck`,
   JSON) — clean.
5. `bun test runbooks/issue-to-pr-v2/` (via `bun_runTests`, JSON) — green;
   `route.test.ts` pinned mapping unchanged.
6. Re-run the parity-audit convergence protocol for the
   `reference-loading-and-routing` seam — confirms the runtime constant
   correctly stays out of the skill (`false-positive: ADR-0002`
   close-out).

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Reconciled note still contradicts itself (softened "discretionary" but didn't state the CLI-absence half) | Medium | D2 forces both halves into the note; U4 greps for both vocabularies |
| Step renumbering in `<orchestration_loop>` breaks an internal "step N" reference | Low | U1 checks for step-number citations before renumbering; prefer "7b" style insertion |
| Edit accidentally reads as "first-run-gotchas.md is CLI-required," tripping the parity-audit seam | Low | D1/D2 frame it as skill-loop load; U4 re-runs the seam convergence; never touch route.ts |
| Over-editing the guide (rewording retire-when bar text that should stay verbatim) | Low | D4 + user decision: bar text stays verbatim; only a parenthetical annotation is folded into each Retire-when line (not a new line after it) |
| Read-trigger reconciliation contradicts the new deterministic load, or the contradiction survives the grep net | Low | U4 step 2 makes the read-trigger edit required and qualifies it to the D3 split; U4 step 3 adds the read-trigger to the grep-consistency net |
| Re-evaluation annotation breaks the guide's entry-governance contract ("each entry ends with Owner and Retire when lines") | Low | U4 step 1 folds the annotation into the Retire-when line as a parenthetical so the line stays terminal; U4 step 3 verifies the contract holds and the governance sentence is untouched |

---

## Deferred Implementation Notes

- Exact wording of the new orchestration-loop step, the reconciled notes,
  the read-trigger qualification, and the three retire-when annotations is
  finalized at edit time against the live file (line numbers in this plan
  are from the 2026-05-24 working tree and may shift).
- The annotation wording in U4 step 1 is illustrative; the implementer
  picks the final phrasing as long as it records the date, the issue, the
  "still open" conclusion, and the loading-vs-targeting reason.
