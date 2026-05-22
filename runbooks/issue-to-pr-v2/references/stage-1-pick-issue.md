# Stage 1: pick-issue reference

**v1 source anchor:** `runbooks/issue-to-pr/issue-to-pr.md` L339-464.

**Read trigger:** open this reference when the orchestrator is starting a new
run on a fresh issue or resuming a Stage 1 turn (before AC confirmation, before
ledger creation, before branch preflight). See also:
[ledger-and-helper.md](ledger-and-helper.md),
[stage-2-plan.md](stage-2-plan.md).

## Inputs

- `{issue-number}` (required).
- `{target-repo}` (optional; defaults to `git remote get-url origin` parsed to
  `owner/repo`).

## Pre-conditions

- Working tree must be clean (`git status --porcelain` returns empty). If
  dirty, fail-stop and ask.
- Stage 1 may start on the default branch, but only for read-only issue
  inspection, AC confirmation, blocker checks, and branch preflight. It must
  create or check out the issue feature branch before the first ledger
  mutation. If a ledger file is created or changed while still on the default
  branch, fail-stop and surface the diff.

## Actions

1. `gh issue view {issue-number} --repo {target-repo} --json number,title,body,labels,state,assignees,url`.
2. Validate `state`:
   - `open` → proceed.
   - `closed` + label `reopen-for-implementation` → proceed.
   - `closed` otherwise → ask user; on `y` proceed, on `n` fail-stop.
3. **Extract `## Blocked by` section.** Parse referenced issue numbers
   (`#\d+`). For each, run
   `gh issue view <n> --repo {target-repo} --json state`. If any blocker is
   `state: open`, check labels from step 1:
   - `force-run` present → proceed and document the override in ledger Notes
     after the ledger exists.
   - `force-run` absent → fail-stop with the canonical message in the v1 source.
4. **Branch preflight before durable gate writes.** Ensure the current branch
   is an issue feature branch before creating or changing any ledger file.
   - Resolve the default branch from
     `gh repo view {target-repo} --json defaultBranchRef`.
   - If `feat/issue-{issue-number}-*` exists locally, check it out.
   - Otherwise create `feat/issue-{issue-number}-pending` from the current
     clean HEAD (slug filled in after Stage 2). Starting from the default
     branch is allowed for this step.
   - If checkout or creation fails, fail-stop. Do not mutate the ledger on the
     default branch.
5. **Extract Acceptance Criteria as a CANDIDATE list.** Never accept as final
   without user confirmation. Pattern order (stop at the first match):
   - `## Acceptance criteria` (any case) + `- [ ]` checkboxes → source
     `gold-standard`, confidence high.
   - `## Acceptance`, `## AC`, `## Definition of done`, `## Done when` +
     checkboxes/bullets → source `variant-heading`, confidence medium.
   - Any contiguous `- [ ]` checkbox block → source `loose-checkbox-block`,
     confidence low.
   - Numbered list under a heading containing `must`, `should`, or
     `requirement` → source `numbered-requirements`, confidence low.
   - Nothing matched → source `none`.
6. **Present + confirm.** Echo the extracted list (or the "none found"
   prompt) inline at end of turn. The user gates every run:
   - **Heuristic matched:** show the list with its source label (for example
     `extracted from "## Acceptance criteria" heading, high confidence`). Ask
     `y` / `edit` / `abort`.
   - **Heuristic did not match (source = `none`):** ask the user one of:
     - `paste` → user pastes a `- [ ]` checkbox list inline; source becomes
       `pasted`; re-display for confirm.
     - `draft` → synthesise a candidate list from the issue's `## What to
       build` prose (or the issue body if no such heading); source becomes
       `drafted`; re-display for confirm (drafted lists ALWAYS need confirm).
     - `abort` → stop, write nothing.
   - On `edit`: take the user's revised list, re-present. Loop on `edit`
     until `y` or `abort`.
   - On `y`: immediately create or resume the ledger and checkpoint the
     confirmed AC state in durable ledger evidence before doing any later
     stage work.
   - On `abort`: stop, fail-stop.
7. Create or resume the ledger at
   `docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md`. (The ledger
   location pointer is a v1-era path; U7 will update both the directory and
   the template source to v2 paths once the hot router cuts over.)
   - Concurrent-run guard: if frontmatter `status == in-progress` with
     `started_at` within the last hour, fail-stop with the concurrent-run
     warning.
   - Re-run guard: if `status == shipped`, ask the user re-run or abandon.
   - First-run: copy from
     `~/.claude/runbooks/issue-to-pr/issue-N-ledger.template.md` until U6
     lands `runbooks/issue-to-pr-v2/issue-N-ledger.template.md` and U7
     points this step at it.
   Populate frontmatter: `issue_number`, `issue_title`, `issue_url`,
   `target_repo`, `started_at` (ISO 8601 with timezone), `status: in-progress`,
   `ac_source`, `ac_confirmation_status: confirmed`, `ac_confirmed_at`,
   `batch_contract_confirmation_status: pending`,
   `batch_contract_confirmed_at: null`, `ship_mode: standard`,
   `final_reviewed_at: null`. Write the confirmed AC list to
   `## Acceptance criteria` as `- [ ]` checkboxes. Compute and store
   `ac_digest` via `decompose.ts --ac-digest <ledger-path>`. Leave
   `plan_digest` and
   `batch_contract_digest` null until Stage 3. If a `force-run` override was
   used, append override evidence to Notes in the same checkpoint.
8. Run `decompose.ts --confirmation-state <ledger-path>`. It must report
   `acceptance_criteria: confirmed`, `batch_contract: pending`,
   `digests: pending`. Any drift fails the stage. Commit before transitioning:
   `chore(issue-{issue-number}): checkpoint acceptance criteria`.

## Exit condition

Ledger exists with populated `## Acceptance criteria` and frontmatter
`ac_confirmation_status: confirmed`; `ac_digest` matches the ledger AC
section; user confirmed the AC list; no open blockers (or override recorded);
current branch is a feature branch; working tree is clean.

## See also

- [ledger-and-helper.md](ledger-and-helper.md) for the ledger schema and
  helper invocation context.
- [stage-2-plan.md](stage-2-plan.md) for the immediate next stage.
