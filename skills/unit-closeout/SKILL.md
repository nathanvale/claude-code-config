---
name: unit-closeout
description: "Close a completed implementation unit with verification, a scoped commit, durable residuals, and a next-unit handoff."
argument-hint: "[plan-path] [unit-id]"
disable-model-invocation: true
---

# Unit Closeout

Use after one implementation unit or task slice is complete. This is the
middle boundary between implementation and full branch shipping. It never
pushes or opens a pull request.

## Dependencies

- Repository git instructions: hard dependency for commit policy. Missing
  state: blocked before commit. Next repair: locate the nearest repository
  instructions or ask for the commit policy.
- `fallow`: optional handoff for meaningful JS or TS changes. Missing state:
  degraded quality evidence. Fallback: run repository-owned checks and report
  the missing Fallow pass.
- `skill-feedback`: optional handoff after a material skill run. Missing state:
  degraded learning evidence. Fallback: report the candidate owner-path
  improvement without changing a skill.
- `handoff`: optional handoff when another unit remains. Missing state:
  degraded continuation. Fallback: return the same continuation facts in the
  final response.

## Workflow

1. Resolve the current unit from the named plan and unit id, or from the active
   implementation slice when no arguments are supplied.
2. Inspect the repository root, branch, status, current diff, existing commits,
   unit requirements, and required verification.
3. Stop if changed files cannot be separated from unrelated user work. Never
   absorb unrelated edits into the unit.
4. Run the unit's focused checks. For meaningful JS or TS changes, hand changed
   code to `fallow` and act on current-task findings before commit.
5. Separate blockers from future residuals. Record residuals in the owning
   project tracker when its path is unambiguous. File material skill-run
   observations through `skill-feedback`.
6. Recheck branch and status. On a protected branch, stop before commit and ask
   for branch authority. Never change branches implicitly.
7. Follow the repository commit workflow. Stage only unit-owned files and
   create one conventional commit. Do not create an empty commit when the unit
   is already represented by a verified commit.
8. Recheck status and the new commit. When another unit remains, create a
   handoff naming the next unit and its first safe action.

## Safety

- Explicit `unit-closeout` invocation authorises one scoped local commit when
  the branch is not protected and the unit-owned files are unambiguous.
- It never authorises branch changes, push, pull request creation, merge,
  force operations, deletion, or unrelated cleanup.
- A failed required check blocks the commit. Report the failing boundary and
  repair path.

## Final Shape

Report the unit, checks, Fallow result or skip reason, residual owner, commit
hash or blocker, working-tree state, handoff path when created, and next safe
action.
