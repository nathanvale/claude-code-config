# Stage 2: plan reference

**v1 source anchor:** `runbooks/issue-to-pr/issue-to-pr.md` L466-513.

**Read trigger:** open this reference when Stage 1 has committed the AC
checkpoint and the orchestrator is about to invoke `/ce-plan`, or when
resuming a Stage 2 turn before the plan file has been recorded in
`frontmatter.plan_path`. See also:
[ledger-and-helper.md](ledger-and-helper.md),
[stage-3-decompose.md](stage-3-decompose.md),
[`templates/ce-plan-addendum.md`](../templates/ce-plan-addendum.md).

## Inputs

Confirmed AC list in the ledger's `## Acceptance criteria` section (from
Stage 1).

## Actions

1. Invoke `/ce-plan` at the top level of this orchestrator session in
   Issue-to-PR pipeline planning posture. The planner produces the plan
   artifact and structured Implementation Units, then returns control to this
   runbook. Pass it:
   - the issue title + body;
   - the ledger's `## Acceptance criteria` section as the canonical AC list;
   - the structured-output addendum body — render it deterministically
     with `cli.ts packet ce-plan --json` (returns the reusable addendum
     verbatim — see [`templates/ce-plan-addendum.md`](../templates/ce-plan-addendum.md)
     for the rendered shape) and append it after the issue body and AC
     list;
   - this posture instruction: "Issue-to-PR pipeline planning posture: write
     the plan and structured unit YAML only; skip post-generation menus,
     deepening prompts, implementation offers, and separate review flows;
     return the plan path."
2. `/ce-plan` writes its plan document to
   `docs/plans/<date>-<NNN>-feat-<slug>-plan.md` per its own conventions.
3. **Verify the plan file exists at the path ce-plan reported.** If `/ce-plan`
   reported success but no file is present, re-invoke once. If still no file,
   fail-stop with `blocked_reason: ce-plan-no-output`.
4. Record the plan path in ledger frontmatter as `plan_path`.
5. Rename the feature branch from `feat/issue-{issue-number}-pending` to
   `feat/issue-{issue-number}-<slug-from-plan-title>`.
6. Commit the ledger (plan path recorded) and the plan file before
   transitioning to Stage 3:
   `chore(issue-{issue-number}): record plan path`.

## Exit condition

Plan file exists at the path recorded in `frontmatter.plan_path`; branch
renamed; ledger and plan file committed; working tree clean.

## Failure modes

- ce-plan asks clarifying questions → forward to user; do not auto-answer.
- ce-plan produces a plan with zero Implementation Units → fail-stop, ask user
  to expand the issue or supply more context.
  `status: blocked`, `blocked_reason: no-implementation-units`.

## See also

- [`templates/ce-plan-addendum.md`](../templates/ce-plan-addendum.md) —
  structured-output addendum appended after the issue body and AC list when
  invoking `/ce-plan`.
- [stage-3-decompose.md](stage-3-decompose.md) — consumes the plan path and
  parses the structured unit YAML.
