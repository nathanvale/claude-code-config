---
name: harden-implementation
description: Review an implementation against its plan and acceptance criteria from multiple adversarial angles, iterating review-fix-re-review until a full round produces zero new findings. Use after building something from a plan when you want the work pressure-tested until it holds, not just one review pass. Triggers like "harden this", "review until there are no reviews left", "break my implementation", "is this actually done".
argument-hint: [path-to-plan-or-implementation, or describe what was built]
disable-model-invocation: true
allowed-tools: Agent, Read, Grep, Glob, Bash, Edit, Write, TaskCreate, TaskUpdate, TaskList
---

# Harden Implementation

Take an implementation built from a plan and pressure-test it from many angles,
fixing what breaks, until a full review round finds nothing new. This is a
**goal loop**: the goal is "zero outstanding findings against the plan and its
acceptance criteria," and the loop keeps working until that condition is met or
a safety cap is hit.

The plan (and its acceptance criteria) is the **yardstick**. The implementation
is the **subject under review**. You are not re-reviewing the plan; you are
checking whether the built work actually satisfies it and survives adversarial
scrutiny.

This is the autonomous sibling of the interactive `grill-me` / `grill-with-docs`
skills, and it slots into the workflow ladder after `ce-work` (build) and around
`ce-code-review`: build, then harden until it holds.

## Quick Start

1. Identify the **plan** (with acceptance criteria) and the **implementation**
   (the diff, files, or change set built from it). Derive the `run-id` and
   check for an existing findings ledger to resume (see Ledgers below).
2. Run rounds of parallel adversarial review (see Loop below).
3. After each round, triage findings, apply fixes, re-review the fixed work,
   and write the round to the findings ledger.
4. Stop when a full round yields **zero new actionable in-scope findings**
   (convergence) or you hit the round cap. Dispatch the scoring agent, then
   report the convergence summary.

## Inputs

Resolve these before starting. Ask only for what you cannot infer:

- **Plan**: a plan doc, PRD, brainstorm, or the stated intent. Holds the
  acceptance criteria the implementation must satisfy. If no written plan
  exists, ask the user to state the goal and acceptance criteria in one or two
  sentences, then treat that as the plan.
- **Implementation**: the change set under review. Prefer a concrete scope:
  a git diff (`git diff <base>...HEAD`), a set of files, or a described change.
  If ambiguous, ask which diff or files are the subject. The plan and the
  implementation may live in different repositories or working trees — resolve
  which repo holds the implementation before reviewing, and run that repo's
  tests, linters, and type checks there (its own runners, not the parent
  session's, which may be rooted elsewhere). When the implementation is in a
  different repo than the session's working directory, MCP code-quality
  runners often **fail silently** — returning zero tests or empty results
  rather than an error — because they root at the session cwd. Verify a runner
  actually executed the target repo's suite (a nonzero test count); if it
  returns nothing, fall back to running the repo's own CLI via the shell `cd`'d
  into that repo. Also capture the working-tree baseline before editing
  (`git -C <impl-repo> status --short`): pre-existing uncommitted changes there
  are not yours, and you must separate them from your hardening edits when
  reporting and committing.
- **Acceptance criteria**: extract them from the plan. If the plan has none,
  derive a short checklist from the stated goal and confirm it with the user
  before looping (a loop with no acceptance criteria cannot converge honestly).
- **Prior run**: derive the `run-id` (see Ledgers) and check
  `ledgers/runs/<run-id>.md`. If one exists with `status: in-progress`, this is
  a resumed run: load its findings, resume from `last_round + 1`, and suppress
  the resolved findings instead of re-deriving them.

## The Loop

The core mechanic is a bounded review-fix-re-review loop with a hard cap of
**5 rounds**. Track rounds and findings with the Task tools so progress
survives context compaction *within* a session, and write the findings ledger
after each round so progress survives the session ending or the loop crashing.

```
Before Round 1: derive run-id; if an in-progress findings ledger exists,
                resume from last_round + 1 with its resolved findings suppressed.

Round N:
  1. Dispatch the review angles IN PARALLEL (one Agent per angle, one message).
  2. Collect findings. Merge duplicates across angles (by signature). Drop
     non-actionable noise.
  3. If zero new in-scope findings of ANY severity (P0/P1/P2/P3) -> CONVERGED
     (go to scoring). A round that surfaced only new P2/P3 is NOT converged: you
     still defer them (step 5) and run another round to confirm nothing new.
  4. Triage: give each finding a severity (P0 | P1 | P2 | P3) and a status
     (fixed | deferred-P2 | deferred-P3 | out-of-scope | open). Out-of-scope
     findings are recorded as gates, not fixed here.
  5. Apply fixes for P0 and P1 findings (edit the implementation). P2/P3
     findings are recorded as deferred (status deferred-P2 / deferred-P3) into
     the audit backlog and carried forward, NOT fixed in this loop. Severity
     decides fix-vs-defer; it does NOT decide when the loop stops.
  6. Re-verify each P0/P1 fix actually addresses the finding (re-read, re-run
     checks).
  7. Write this round to ledgers/runs/<run-id>.md (findings with signature,
     severity, status, fixes, last_round). This is the crash-recovery point.
  8. Go to Round N+1 (re-review the FIXED implementation, not the original).

Stop when: a full round produces zero new in-scope findings of any severity
             (out-of-scope findings, recorded as gates, do not block
             convergence of the slice under review),
           OR round == 5 (report remaining findings honestly as not-yet-clean),
           OR a finding requires a decision only the user can make (pause, ask).

After stopping (any outcome): dispatch the scoring agent (see Ledgers), then
report.
```

Convergence is "a full round found nothing new at all," not "I ran out of
rounds" and not "P0/P1 are clean." Always say which one happened. P2/P3 are
*fixed-vs-deferred* differently from P0/P1 (deferred to the audit backlog, not
fixed), but a newly-surfaced P2/P3 still costs another round: the loop only
converges when a full round finds nothing new at any level.

### Why parallel angles

A single review pass sees what one lens sees. Today's effectiveness came from
attacking the same work from **independent adversarial angles at once**, then
merging. Each angle is a fresh agent with no stake in the implementation being
correct; its job is to find what breaks, not to confirm the work.

See [references/review-angles.md](references/review-angles.md) for the full
angle catalog, which `ce-*` agents to dispatch, and what each is responsible
for. Load it before dispatching the first round.

## Dispatching a round

Dispatch reviewers as parallel `Agent` calls in a **single message** so they run
concurrently. Pick the angles that fit the change (the reference file maps
change types to angles). For each reviewer, pass:

- the plan + acceptance criteria (the yardstick),
- the concrete implementation scope (diff or file list),
- the angle's specific charter (what to attack),
- the findings already resolved in prior rounds (so they do not re-raise fixed
  issues),
- an instruction to return the structured reviewer envelope
  ([references/reviewer-envelope.md](references/reviewer-envelope.md)) — only
  actionable findings, each with a `severity` (`P0|P1|P2|P3`), location
  (`file:symbol`, not line numbers), a concrete failure scenario, and a stable
  `signature` for cross-angle dedup; not praise.

Prefer the specialized `ce-*` reviewer agents where they fit (they encode strong
review personas). Use `general-purpose` only for angles no `ce-*` agent covers.

## Merging and triage

After each round:

1. **Merge** findings across angles. Two reviewers flagging the same root issue
   is one finding, recorded once.
2. **Drop** non-actionable findings: style nits with no behavioral impact,
   speculative "could one day," anything already covered by an accepted note.
3. **Rate** each survivor with a `severity` and a `status` (shared vocabulary
   with the issue-to-pr Validator findings):
   - `severity`: `P0` violates an acceptance criterion or breaks
     correctness/safety *of the slice under review*; `P1` serious weakness to
     fix this slice; `P2` real but deferrable; `P3` minor. This is the
     filterable lens — `grep '| P0 \|| P1 '` is the fix list, `grep deferred`
     the audit backlog.
   - `status`: `fixed` (a P0/P1 fixed this round), `deferred-P2` / `deferred-P3`
     (recorded to the audit backlog, not fixed here), `out-of-scope` (fix lives
     outside this slice — record as a gate, do not edit the subject to chase
     it), or `open` (a P0/P1 not yet fixed, e.g. when paused or capped).
4. **Fix** P0 + P1 (set `status: fixed`). **Re-verify** each fix against the
   finding. **Defer** P2 + P3 to the audit backlog (`deferred-P2` /
   `deferred-P3`) — do not fix them in this loop.
5. Deferred P2/P3 and `out-of-scope` findings do not block this slice's
   convergence, but all are reported. An `out-of-scope` finding that is
   *blocking for shipping* (e.g. the slice ships a contract ahead of its
   enforcement in a later slice) must be recorded as an explicit gate: name
   what must land before the work is safe to ship, and never silently treat it
   as fixed. Hardening a slice does not authorize implementing a different one.
   Deferred-P2/P3 rows are carried forward across runs as a standing audit
   backlog future-you can pick up.

## Ledgers

Two durable ledgers beside the skill make the loop resilient and compounding.
Full format and metric contract: [references/ledgers.md](references/ledgers.md).
Load it when starting a run and when scoring.

- **Findings ledger** (`ledgers/runs/<run-id>.md`, gitignored): per-run,
  written after each round. Enables crash recovery and resume — a fresh run
  with an existing in-progress ledger continues from where it stopped instead
  of re-deriving findings.
- **Reviewer scorecard** (`ledgers/reviewer-scorecard.md`, committed):
  cross-run, append-only. One row per angle per run, plus a regenerated
  aggregate, so "which angles earn their keep, by change type" is answered with
  data, not hunch. When picking the Round 1 angle set, consult the aggregate
  for the matching `change_type`; fold or drop standing drop-candidate angles.
  Treat it as advisory until ~5 runs of that change_type exist — until then,
  keep casting the wide default net.

At the end of every run, dispatch one `general-purpose` **scoring agent** as an
arms-length grader (it did not make the dispatch decisions). It reads the
findings ledger, computes each angle's metrics, appends scorecard rows, and
regenerates the aggregate. It must not edit the implementation or the findings
ledger. See the scoring-agent charter in the reference.

## Fixing safely

This skill edits the implementation. Apply the same discipline that makes the
loop trustworthy:

- Fix the root cause, not the symptom. Do not suppress a finding to make a round
  look clean.
- Re-verify each fix: re-read the changed code, re-run the relevant checks
  (tests, types, lint) using the project's runners.
- Stay in scope: fix the finding, do not refactor adjacent code.
- If a fix is risky, outward-facing, or irreversible, or if a finding needs a
  product/scope decision, **pause and ask the user** rather than deciding
  unilaterally. A hardening loop must not silently make consequential choices.
- Record what changed each round so the convergence report is honest.

## Output

After the loop stops, dispatch the scoring agent (see Ledgers) so the
reviewer scorecard captures this run before you report. Then end with a
**Convergence Report**:

- **Outcome**: converged (zero new findings of any severity in the final round)
  OR capped (hit round 5 with findings still open) OR paused (needs a user
  decision).
- **Rounds run** and findings per round, by severity (the trend should fall
  toward zero new findings at every level).
- **Acceptance criteria**: each one, met / not-met, with evidence.
- **P0/P1 fixed**: what was wrong, what changed, how it was re-verified.
- **Deferred audit backlog (P2/P3)**: each `deferred-P2` / `deferred-P3`
  finding, recorded for a later audit pass, not fixed this loop. They are
  deferred (not fixed) but still had to be *found* — the loop only converges
  once a round surfaces no new P2/P3 either. List them so future-you can pick
  them up.
- **Out-of-scope gates**: real findings fixable only outside this slice, with
  the named work that must land before the slice is safe to ship.
- **Edit attribution** (when the implementation repo had a dirty tree at
  start): which files this loop changed versus pre-existing changes it left
  untouched. Never imply you authored changes that were already there.
- **Honest gaps**: anything the loop could not verify, or where evidence was
  weaker than the report implies.

Never report "clean" on a round that did not actually run all chosen angles, and
never claim convergence when you simply hit the cap.

## Anti-patterns

- **One-and-done**: a single review pass is not this skill. Loop until convergence.
- **Confirmation reviewers**: reviewers that look for reasons the code is fine.
  Each angle's job is to break it.
- **Fixing to silence, not to fix**: editing code to make a finding stop firing
  without addressing the root cause.
- **Faking convergence**: declaring clean because you hit the cap or skipped an
  angle. Report the real outcome.
- **Scope creep in fixes**: hardening one finding by rewriting unrelated code.
- **No acceptance criteria**: looping with nothing to converge against. Get the
  criteria first.
- **Skipping the ledger write**: a round that fixes findings but does not write
  the findings ledger leaves the loop unrecoverable if it crashes. Write after
  every round.
- **Self-grading the scorecard**: scoring inline instead of via the arms-length
  scoring agent, or inflating an angle's `new_breaks`. The scorecard is only
  worth trusting if it grades honestly — count from the ledger, not impressions.
