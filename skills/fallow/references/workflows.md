# Fallow Workflows

## Self-Review

- Finish the implementation slice first.
- Challenge suspect targets before readiness checks.
- Start with changed-code plain summary evidence when target fit is plausible.
- Run `doctor` only when readiness is unknown or changed-code evidence blocks.
- Use JSON only when issue references, repair planning, or structured comparison is needed.
- Use command help when exact syntax matters.
- Fix or flag findings using local judgment and project rules.
- Rerun the same evidence command.
- Report current-task findings first.
- Report pre-existing findings as count or status context unless cleanup is in scope.
- Report before/after summary when evidence changed.

## Cleanup Pass

- Start bare cleanup asks with health summary evidence.
- Start removal asks with dead-code evidence.
- Start duplication asks with dupes evidence.
- Start complexity, coupling, or score asks with health evidence.
- Keep per-finding refactor plans outside the runner.
- Suggest architecture or review workflows only when evidence exceeds Fallow's lane.
- Keep broader workflows opt-in.

## Changed-Code Audit

- Use `audit` after implementation or before review.
- Audit auto-detects the base branch; provide an explicit base only when the task or branch context needs it.
- Read the attribution split before triaging individual findings.
- Treat pre-existing findings as separate cleanup unless the current task owns them.

## Audit Attribution

Audit runs `--gate new-only`: it separates findings the changeset introduced from
inherited base findings, so the runner does the changed-vs-pre-existing split for you. This
replaces manual coverage-intersect for audit.

- Read the plain `attribution gate=new-only introduced=N inherited=M` line first.
- Act on findings tagged `introduced: true`; treat `introduced: false` as base context.
- `next_action=continue introduced=0` means the changeset added nothing; stop without per-finding triage.
- Parse JSON and filter `issue_references` on `introduced` when a finding list is needed.
- Read `summary.mode_evidence.attribution` for per-category introduced counts.
- Attribution covers audit only; `dead-code`, `health`, and `dupes` need the coverage-intersect pass below.

## Finding Resolver Actions

Audit issue references may advertise a Finding resolver action: a tiny runnable
continuation for one introduced finding. Start from the finding, not a remembered
command.

- Follow the action only when an introduced `remove-export` finding advertises one;
  inherited and coordinate-missing findings never do.
- Run the advertised target (`why`) to gather reachability evidence for that one
  export; use runner help for current coordinates.
- Read the evidence grade first; the verdict and next action are derived helpers.
- Referenced or entry-point evidence means keep the export.
- Absence of trace references is a removal candidate, not deletion proof; keep
  judgment local before deleting.
- Unresolved or unavailable trace evidence blocks deletion; follow the repair hint.
- This is the audit resolver path. It is distinct from the non-audit
  coverage-intersect cleanup below, which has no per-finding resolver action.

## Coverage Intersect

Use for non-audit modes (`dead-code`, `health`, `dupes`), which carry no attribution.
Fallow cannot see indirect coverage or distinguish a contract export from dead code. On
skill or CLI folders that export a public contract and test through an integration entry
point, raw `add-tests` and `remove-export` findings run mostly false-positive. Intersect
with coverage before treating any as real.

- Drop every `remove-export` on a contract-surface or entry-point file; verify the symbol
  is unreferenced by tests and other modules before considering removal.
- Run scoped coverage for the changed file: `bun test <file>.test.ts --coverage`.
- Keep an `add-tests` finding only when its function's lines appear in the uncovered set.
- Drop survivors that are real-runtime I/O seams stubbed by a test runtime factory;
  testing the mock-bypassed path adds no signal.
- What remains is pure functions with uncovered branches; those are worth tests.
- Report the collapsed real count, not the raw finding count.

## Preview And Apply

- Run `fix-preview` before source mutation.
- Read `references/safety.md` for the apply boundary.
- Rerun the prior evidence command after apply.

## Request Examples

- "I just built this; check the diff before PR" -> self-review route; start with changed-code plain summary evidence.
- "Look for dead code in this module" -> cleanup route; start with dead-code evidence.
- "Can Fallow fix this?" -> preview route; stop before apply until safety allows mutation.
- "This repo does not look like JS/TS" -> target-fit route; challenge or retarget before readiness checks.

## Blocked Runs

- Read the failure category.
- Follow the first safe repair hint.
- Run `doctor` when setup cause is unclear.
- Retry the same input only when the hint says retry is safe.
- Keep per-finding repair plans outside blocked runner recovery.

## Stop

- Stop when the runner cannot produce usable evidence and no repair hint applies.
- Stop before mutation when `references/safety.md` blocks the next action.
- Stop before broad refactors that exceed the current task.
