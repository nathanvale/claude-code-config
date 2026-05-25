# Review Angles

The hardening loop's power comes from attacking the implementation from several
**independent** angles at once, each a fresh agent whose job is to break the
work, not confirm it. This file is the angle catalog: what each angle attacks,
which agent to dispatch, and when to include it.

Dispatch the chosen angles as parallel `Agent` calls in a single message so they
run concurrently. Re-dispatch the relevant angles each round against the FIXED
implementation.

## Always-on angles

Run these every round regardless of change type.

| Angle | What it attacks | Preferred agent |
| --- | --- | --- |
| Adversarial | Actively constructs failure scenarios to break the implementation: bad input, race, partial failure, wrong assumptions. The lens that found today's bugs. | `compound-engineering:ce-adversarial-reviewer` |
| Correctness | Logic errors, edge cases, state bugs, error propagation, intent-vs-implementation mismatch. | `compound-engineering:ce-correctness-reviewer` |
| Acceptance-criteria | Walks each acceptance criterion from the plan and checks the implementation actually satisfies it, with evidence. Fails the criterion, does not assume. | `general-purpose` (charter: verify each criterion against the diff; cite evidence) |
| Maintainability | Premature abstraction, dead code, coupling, naming that hides intent. | `compound-engineering:ce-maintainability-reviewer` |
| Testing | Coverage gaps, weak assertions, brittle implementation-coupled tests, missing edge cases. | `compound-engineering:ce-testing-reviewer` |

## Conditional angles

Add these when the change touches the matching domain. Over-dispatching wastes
rounds; pick what fits the diff.

| Trigger in the change | Angle | Preferred agent |
| --- | --- | --- |
| auth, public endpoints, user input, permissions, secrets | Security | `compound-engineering:ce-security-reviewer` |
| DB queries, loops over data, caching, I/O-heavy paths | Performance | `compound-engineering:ce-performance-reviewer` |
| migrations, schema changes, backfills, data transforms | Data migration | `compound-engineering:ce-data-migration-reviewer` |
| retries, timeouts, circuit breakers, background jobs, async handlers | Reliability | `compound-engineering:ce-reliability-reviewer` |
| API routes, request/response types, serialization, versioning | API contract | `compound-engineering:ce-api-contract-reviewer` |
| async UI, Stimulus/Turbo, DOM-timing-sensitive frontend | Frontend races | `compound-engineering:ce-julik-frontend-races-reviewer` |
| Swift / SwiftUI / iOS | Swift/iOS idiom | `compound-engineering:ce-swift-ios-reviewer` |
| language-idiom (Rails, TypeScript, Python, etc.) | Language idiom | language-specific `ce-*` reviewer if one is installed; otherwise `general-purpose` with a charter to enforce that language's idioms and type safety |
| the change can over-reach the stated goal | Scope guard | `compound-engineering:ce-scope-guardian-reviewer` |
| simplicity matters / YAGNI risk | Simplicity | `compound-engineering:ce-code-simplicity-reviewer` |

Agent availability varies by installed plugins. Before dispatching a named
`ce-*` agent, prefer ones you can confirm are available; if a named reviewer is
not installed, dispatch `general-purpose` with a tight charter describing
exactly what to attack and what counts as a finding. Never block a round because
one specialized agent is missing, substitute `general-purpose` and proceed.

## Charter every reviewer with

Each dispatched agent must receive:

1. **The plan + acceptance criteria** (the yardstick).
2. **The concrete implementation scope**: a diff (`git diff <base>...HEAD`) or an
   explicit file list. Do not make the reviewer guess what changed.
3. **The angle's charter**: the single lens it owns (from the tables above).
4. **Resolved findings so far**: the list of findings already fixed in prior
   rounds, with the instruction not to re-raise them.
5. **Output contract**: return ONLY actionable findings. Each finding needs:
   - a one-line description of the problem,
   - severity (`blocking` / `should-fix` / `note-only`),
   - location as `file:symbol` or `file:section` (never a bare line number,
     line numbers drift),
   - a concrete failure scenario or the acceptance criterion it violates.
   No praise, no summary of what the code does well.

## Picking the round's angle set

- **Round 1**: all always-on angles plus every conditional angle the diff
  triggers. Cast the widest net first.
- **Later rounds**: re-run the angles that produced findings last round, plus
  adversarial + correctness (always), against the fixed code. You may drop an
  angle once it has produced zero findings two rounds running.
- **Final round**: re-run the full always-on set to confirm convergence is real,
  not an artifact of a narrowed angle set.

## Convergence honesty

A round is only "clean" if every angle you dispatched returned zero actionable
findings AND the acceptance-criteria angle reports every criterion met with
evidence. Hitting the round cap is not convergence; report it as capped with the
open findings listed.
