      # Runbook: Issue to PR

**Seam:** Drive a GitHub issue to a green PR using the Builder/Validator
pattern over DAG-ordered batches.

**Ledger:** per-issue, at `docs/runbooks/issue-to-pr/issue-<N>-ledger.md` in
the target repo. Template at [issue-N-ledger.template.md](issue-N-ledger.template.md).

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Files in scope

This runbook does not own a fixed file list. The Builder is only permitted to
touch the files listed in the current batch's `files` field (see `## Batch
schema`). Out-of-scope edits trigger a fail-stop (see `## Inner loop` and
`## Escape hatches`).

## Suggested reviewer personas

Always-on, dispatched in parallel after every Builder commit inside `## Inner
loop`:

- `compound-engineering:ce-correctness-reviewer`
- `compound-engineering:ce-testing-reviewer`
- `compound-engineering:ce-maintainability-reviewer`
- `compound-engineering:ce-project-standards-reviewer`
- `compound-engineering:ce-adversarial-reviewer`

Conditional, dispatched only when the diff matches. See `## Persona selector`
for the trigger rules.

## ADR guardrails

This runbook does not pin ADRs of its own (it is a workflow definition, not a
codebase boundary). It does enforce the **target repo's** ADRs at validate
time: if any persona surfaces a finding citing the target repo's `docs/adr/*`,
the inner-loop `ADR-contradicts-<id>` escape hatch fires.

## Role boundaries

The role language is executable contract language:

- Planner (`/ce-plan`) proposes candidate batches, files, dependencies,
  `execution_mode`, acceptance tests, AC mapping, and rationales.
- `decompose.ts` parses the candidate plan and rejects machine-checkable drift.
- User gates confirm the AC list at stage 1 and the DAG plus execution modes
  at stage 3.
- The ledger stores the confirmed execution contract.
- Builder implements exactly one batch under the confirmed ledger contract, or
  fail-stops if that contract is unsafe or stale after reading the files.
- Validator personas are read-only reviewers. They do not fix, choose modes, or
  re-rank severity.

## Scoped audit prompt

This runbook's "audit prompt" is not a `/ce-code-review` prompt body. It is
the stage protocol below. The final-review stage does invoke `/ce-code-review`
once over the cumulative diff; that prompt is generated from ce-code-review's
own skill body, not declared here.

---

## Inter-stage precondition: clean tree

Before transitioning from stage N to stage N+1, the working tree MUST be
clean (`git status --porcelain` returns empty). Builder commits inside
batch-loop must land before any stage transition. The decompose stage's
ledger edits, frontmatter updates, and YAML block insertions all count: they
must be committed (one commit per stage transition is the convention) before
the next stage begins.

Stage 4 lifecycle ledger checkpoints are the same kind of orchestrator-owned
state transition. They are visible `batch-loop` turns, but they are not
Builder commits and they do not count toward the Builder / Validator
iteration count.

A non-empty working tree at stage transition is a runbook bug. Fail-stop and
surface the diff.

---

## Stages

Six stages, walked in order. Each turn advances exactly one stage, commits one
ledger lifecycle checkpoint, or, for `batch-loop`, runs exactly one inner-loop
iteration.

At the start of every resumed turn and before every stage transition after
stage 3, recompute the stored `plan_digest`, `batch_contract_digest`, and
`ac_digest`. If any digest is null while `## Batches` is populated, or any
digest differs, fail-stop and return to stage 3 confirmation before Builder
or ship work continues. `batch_contract_digest` covers only immutable batch
contract fields: id, name, goal, files, depends_on, execution_mode,
acceptance_tests, ac_mapping, and rationale. It does not cover mutable
lifecycle fields such as status, builder_commits, iterations, or
final_verdict. Recompute the three digests with:

- `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --plan-digest <plan-path>`
- `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --batch-contract-digest <ledger-path>`
- `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --ac-digest <ledger-path>`

### Stage 1: `pick-issue`

**Inputs:** `{issue-number}` (required), `{target-repo}` (optional, defaults
to `git remote get-url origin` parsed to `owner/repo`).

**Pre-conditions:**

- Working tree must be clean (`git status --porcelain` returns empty). If
  dirty, fail-stop and ask.
- Stage 1 may start on the default branch, but only for read-only issue
  inspection, AC confirmation, blocker checks, and branch preflight. It must
  create or check out the issue feature branch before the first ledger
  mutation. If a ledger file is created or changed while still on the default
  branch, fail-stop and surface the diff.

**Actions:**

1. `gh issue view {issue-number} --repo {target-repo} --json
   number,title,body,labels,state,assignees,url`.

2. Validate `state`:
   - `open` → proceed.
   - `closed` + label `reopen-for-implementation` → proceed.
   - `closed` otherwise → ask user; on `y` proceed, on `n` fail-stop.

3. **Extract Acceptance Criteria from the body as a CANDIDATE list.** Never
   accept as final without user confirmation. Try these patterns in order;
   stop at the first that produces at least one item:
   - `## Acceptance criteria` (any case) + `- [ ]` checkboxes → source =
     `gold-standard`, confidence = high (the `/to-issues` shape).
   - `## Acceptance`, `## AC`, `## Definition of done`, `## Done when` (any
     case) + checkboxes or bulleted list → source = `variant-heading`,
     confidence = medium.
   - Any contiguous block of `- [ ]` checkboxes anywhere in the body →
     source = `loose-checkbox-block`, confidence = low.
   - Numbered list (`1.`, `2.`, ...) under a heading containing `must`,
     `should`, or `requirement` → source = `numbered-requirements`,
     confidence = low.
   - Nothing matched → source = `none`.

4. **Present + confirm.** Echo the extracted list (or the "none found"
   prompt) inline at end of turn. The user gates every run:
   - **Heuristic matched:** show the list with its source label
     (e.g. "extracted from `## Acceptance criteria` heading, high
     confidence"). Ask `y` / `edit` / `abort`.
   - **Heuristic did not match (source = `none`):** ask the user one of:
     - `paste` → user pastes a `- [ ]` checkbox list inline. Source =
       `pasted`. Re-display for confirm.
     - `draft` → synthesise a candidate list from the issue's `## What to
       build` prose (or the issue body if no such heading). Source =
       `drafted`. Re-display for confirm (drafted lists ALWAYS need
       confirm).
     - `abort` → stop, write nothing.
   - On `edit`: take the user's revised list, re-present. Loop on `edit`
     until `y` or `abort`.
   - On `y`: store the confirmed list in memory for the ledger write in
     step 7. Do not write to disk yet.
   - On `abort`: stop, fail-stop.

5. **Extract `## Blocked by` section.** If present, parse referenced issue
   numbers (matching `#\d+`). For each, run `gh issue view <n> --repo
   {target-repo} --json state`. If any blocker is `state: open`, check the
   target issue labels from step 1:
   - If the target issue has a `force-run` label, proceed and document the
     blocker override in the ledger Notes section after the ledger exists.
   - If the target issue does not have a `force-run` label, fail-stop:
     `Issue #{issue-number} is blocked by open issues: #A, #B, #C. Resolve
     them first, add a 'force-run' label to override, or run on the
     unblocked dependency first.`

6. **Branch preflight before ledger mutation.** Ensure the current branch is
   an issue feature branch before creating or changing any ledger file.
   - Resolve the default branch from
     `gh repo view {target-repo} --json defaultBranchRef`.
   - If a feature branch matching `feat/issue-{issue-number}-*` already
     exists locally, check it out.
   - Otherwise create `feat/issue-{issue-number}-pending` from the current
     clean HEAD. The slug is filled in after stage 2 from the plan title.
     Starting from the default branch is allowed for this step.
   - If branch checkout or creation fails, fail-stop. Do not mutate the
     ledger on the default branch.

7. Create or resume the ledger at
   `docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md`.
   - If the ledger already exists and frontmatter `status == in-progress`
     with `started_at` within the last hour, fail-stop with the
     concurrent-run warning (see Failure mode 11).
   - If the ledger already exists and frontmatter `status == shipped`, ask
     user whether to start a re-run (re-run on an already-shipped issue) or
     abandon.
   - If the file does not exist, copy from
     `~/.claude/runbooks/issue-to-pr/issue-N-ledger.template.md`.
   Populate frontmatter: `issue_number`, `issue_title`, `issue_url`,
   `target_repo`, `started_at` (ISO 8601 with timezone),
   `status: in-progress`, `ac_source: <one of the source values above>`.
   Set `ship_mode: standard` and `final_reviewed_at: null`.
   Write the confirmed AC list to the ledger's `## Acceptance criteria`
   section as `- [ ]` checkboxes.

8. Commit the ledger (initial state) before transitioning to stage 2:
   `chore(issue-{issue-number}): bootstrap issue-to-pr ledger`.

**Exit condition:** Ledger exists with populated `## Acceptance criteria` and
frontmatter; user has confirmed the AC list; no open blockers (or override
recorded); current branch is a feature branch; working tree is clean
(ledger has been committed).

**Stage 1 → stage 2 transition:** Echo ledger frontmatter + AC list at end
of turn. Next turn starts at stage 2.

### Stage 2: `plan`

**Inputs:** Confirmed AC list in ledger's `## Acceptance criteria` section
(from stage 1).

**Actions:**

1. Invoke `/ce-plan` at the top level of this orchestrator session in
   Issue-to-PR pipeline planning posture. The planner should produce the plan
   artifact and structured Implementation Units, then return control to this
   runbook. It must not open its post-generation menu, deepen the plan, offer
   to implement, or start a separate review flow unless it cannot produce a
   usable plan without user input. Pass it:
   - The issue title + body.
   - The ledger's `## Acceptance criteria` section as the canonical AC list.
   - The structured-output addendum (verbatim, see `## ce-plan addendum`).
   - This instruction: "Issue-to-PR pipeline planning posture: write the plan
     and structured unit YAML only; skip post-generation menus, deepening
     prompts, implementation offers, and separate review flows; return the
     plan path."

2. `/ce-plan` writes its plan document to
   `docs/plans/<date>-<NNN>-feat-<slug>-plan.md` per its own conventions.

3. **Verify the plan file exists at the path ce-plan reported.** If
   `/ce-plan` reported success but no file is present, re-invoke once. If
   still no file, fail-stop with `blocked_reason: ce-plan-no-output`.

4. Record the plan path in ledger frontmatter as `plan_path`.

5. Rename the feature branch from `feat/issue-{issue-number}-pending` to
   `feat/issue-{issue-number}-<slug-from-plan-title>`.

6. Commit the ledger (plan path recorded) and the plan file before
   transitioning to stage 3:
   `chore(issue-{issue-number}): record plan path`.

**Exit condition:** Plan file exists at the path recorded in
`frontmatter.plan_path`; branch renamed; ledger and plan file committed;
working tree clean.

**Failure modes:**

- ce-plan asks clarifying questions → forward to user; do not auto-answer.
- ce-plan produces a plan with zero Implementation Units → fail-stop, ask
  user to expand the issue or supply more context. Ledger frontmatter
  `status: blocked`, `blocked_reason: no-implementation-units`.

### Stage 3: `decompose`

**Inputs:** Plan document from stage 2; AC list in ledger.

**Actions:**

1. Invoke the decompose helper:
   `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts <plan-path>`.
   - Output: a YAML batches block printed to stdout.
   - Errors: non-zero exit with a parse-error message on stderr.

2. If the helper exits non-zero, fail-stop with the parse error verbatim.
   Frontmatter `status: blocked`,
   `blocked_reason: decompose-parse-error`.

3. Validate the parsed DAG:
   - Every batch has all required fields.
   - Every batch id is unique.
   - Every `depends_on` reference resolves to a batch id.
   - The DAG is acyclic (topological sort succeeds).
   - Every batch has at least one file and at least one acceptance test.
   - Every file path is repo-relative, stays inside the repo, and is unique
     within the batch.
   - Every batch has an `execution_mode` of `tdd`, `proof_first`, or
     `change_first`.
   - Every normal batch has at least one AC index in `ac_mapping`; only
     `patch-*` batches may use `ac_mapping: []`.
   - Every AC index in `ac_mapping` is unique within the batch and falls
     inside the ledger's AC range.
   - `change_first` batches pass the runbook guardrails: docs-only paths are
     allowed by default; non-doc generated config, mechanical changes,
     runtime changes, and investigation placeholders must carry an explicit
     rationale prefix so the stage 3 user gate can accept them deliberately.

4. **Validate AC coverage.** Invoke
   `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts <plan-path>
   --validate-ac-coverage <ledger-path>`. Every AC index (1..N) in the
   ledger's `## Acceptance criteria` section must appear in at least one
   batch's `ac_mapping`. Any AC not covered triggers fail-stop:
   `AC <i> ('<text>') is not covered by any batch. Re-invoke ce-plan with
   explicit instruction, or accept by adding a batch with ac_mapping: [<i>]
   and rationale: 'out-of-scope: investigation-required' (creates a
   follow-up issue placeholder).`

5. **Surface rationales.** If any batch has a non-null `rationale` field,
   print it alongside that batch in the confirm prompt. The user sees why
   ce-plan deviated from 1:1 AC-to-batch mapping and which `change_first`
   exceptions they are accepting.

6. Record digests for the plan file, the ledger's `## Acceptance criteria`
   section, and the candidate batch contract. Use the helper commands so
   every run hashes the same payloads:
   - `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --plan-digest <plan-path>`
   - `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --ac-digest <ledger-path>`
   - `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts <plan-path> --candidate-contract-digest`
   Print the candidate batch list inline at end of turn, including each
   `execution_mode`, any rationale, and all three digests. Ask the user to
   confirm the exact AC text, DAG, and execution modes before entering
   `batch-loop`. On `n`, stop and discuss.

7. On `y`, re-run the helper and AC coverage check, then recompute the plan
   digest, AC digest, and batch contract digest. If any digest changed, do
   not write to the ledger. Print the changed candidate batch list and ask
   for confirmation again.

8. After the re-check passes with matching digests, paste the YAML block into
   the ledger's `## Batches` section. Set all batches to `status: pending`.
   The ledger's `## Batches` section is the confirmed execution contract;
   never write candidate batches there before the user confirms the current
   digest triple. Store `plan_digest`, `batch_contract_digest`, and
   `ac_digest` in the ledger frontmatter with the confirmed values.

9. Commit the ledger (batches recorded) before transitioning to stage 4:
   `chore(issue-{issue-number}): record batch DAG`.
   Before the commit, run
   `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --validate-ledger-batches <ledger-path>`
   and `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --batch-contract-digest <ledger-path>`.

**Exit condition:** Ledger has populated `## Batches` YAML block with all
batches at `status: pending`; every AC covered; user has confirmed; working
tree clean.

**Failure modes:**

- Cyclic DAG → fail-stop, print the cycle, ask user to revise the plan.
  `blocked_reason: cyclic-dag`.
- Implementation Unit with no files → fail-stop, ask user. A batch with no
  files cannot be validated by the persona suite.
- Implementation Unit with no acceptance tests → fail-stop, ask user. Every
  batch needs a verifiable acceptance condition.
- Implementation Unit with missing or invalid `execution_mode` → fail-stop,
  ask user to revise the plan. Builder cannot infer whether the batch should
  use TDD, proof-first execution, or change-first execution.
- AC uncovered → fail-stop (see step 4).

### Stage 4: `batch-loop`

**Inputs:** Ledger with batches in topological order.

**Outer loop:**

1. Select the next batch: first batch in YAML order where `status ==
   pending` AND every batch in `depends_on` has terminal-success status
   (`converged` or `accepted-risk`). (v1 sequential mode: this is always the
   next eligible pending row.)
2. Mark `status: in-progress` and commit a ledger-only lifecycle checkpoint
   before Builder starts:
   `chore(issue-{issue-number}): start <batch-id> batch`.
   This is a stage-visible `batch-loop` turn. It does not count toward
   `iterations`, and it is outside Builder scope discipline because the
   orchestrator owns ledger lifecycle state. Stage only the per-issue ledger
   path and verify the working tree is clean after the commit.
3. Run the inner loop (see `## Inner loop` below).
4. On inner-loop success: set `status: converged`, append the Builder commit
   refs to `builder_commits`, set `iterations` to the number of Builder /
   Validator attempts for that batch, and set `final_verdict: converged`.
   Auto-close batch P2/P3 findings as `deferred-P2` / `deferred-P3`, update
   the rendered findings table, run `--validate-findings`, and commit a
   ledger-only lifecycle checkpoint:
   `chore(issue-{issue-number}): converge <batch-id> batch`.
   This is a stage-visible `batch-loop` turn. It does not count toward
   `iterations`, and it may touch only the per-issue ledger path. Continue to
   step 1.
5. On inner-loop escape-hatch fire or iteration-cap hit: fail-stop and ask
   the user. Options:
   - Accept remaining findings as risk: close the relevant `## Findings data`
     rows with `status: accepted-risk` and
     `resolution: "accepted-risk: <reason>"`, set batch
     `status: accepted-risk`, set `final_verdict: accepted-risk`, commit the
     ledger, and let dependents proceed.
   - Reframe the batch: set `status: blocked`, set
     `final_verdict: blocked-for-user`, record the decision in Notes, and ask
     the user for the revised batch contract.
   - Abandon the run: set `status: blocked`, set
     `final_verdict: blocked-for-user`, and stop.
6. If pending batches remain but none are eligible, fail-stop with
   `blocked_reason: no-eligible-batch` and print the blocked dependencies.
7. When no batches remain pending: working tree must be clean; advance to
   stage 5.

**Exit condition:** Every batch has `status: converged` (or `accepted-risk`
with user confirmation); working tree clean.

### Stage 5: `final-review`

**Inputs:** Cumulative diff after all batches converged
(`git diff <default-branch>...HEAD`).

**Actions:**

1. Clean up completed Builder and Validator agents from earlier stages when
   the host provides an agent close primitive and the run has already seen a
   cap-related agent failure. Do not preemptively reduce fanout in hosts such
   as Claude Code where `/ce-code-review` can run its normal suite. If cleanup
   is unavailable, continue and record that in Notes.

2. Invoke `/ce-code-review` at the top level of this orchestrator session.
   Pass it the diff range (current branch vs default branch). Invoke in
   read-only / report-only mode; the Builder applies fixes, not the
   reviewer. (The Builder/Validator separation is the whole point of this
   runbook; do NOT use `mode:autofix`.) Full `/ce-code-review` is the default.
   Only fall back after a concrete cap-related failure. If that happens, close
   completed agents if possible and retry the full review once. If it still
   cannot run, preserve the intended reviewer list and run report-only
   reviewer waves. Start with one reviewer per wave when the remaining headroom
   is unknown; otherwise use the largest wave size the host has already proven
   can run. Close completed agents between waves when the host supports it.
   Prefer completing the full reviewer list sequentially over dropping
   reviewers. Reduce the suite only as the last fallback, keep the largest set
   the host can run, and record any omitted reviewers plus the cap reason in
   Notes. If the fallback cannot cover correctness and testing, fail-stop.

3. ce-code-review returns findings. Write them into `## Findings data` with
   `batch_id: final`, then update the human-readable `## Findings` table from
   that data. Run
   `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --validate-findings <ledger-path>`
   before reading the open P0/P1 gate.

4. Apply the same P0/P1 gate as the inner loop:
   - If open P0/P1 == 0 → run
     `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --assert-no-open-p0p1 <ledger-path>`,
     close final-review P2/P3 rows as described in step 5, then advance to
     stage 6.
   - If open P0/P1 > 0 → enter the **final-review inner loop**:
     - For each open P0/P1, classify the finding's scope:
       - If finding's fix touches ≤2 files (and those files are already in
         some batch's `files` OR are new files of comparable shape with an
         explicit `new-file-patch-exception:` rationale; use
         `high-risk-new-file-patch-exception:` for auth, payment, API, data,
         privacy, or other high-risk paths) →
         propose a **patch-batch** with `id: patch-NNN` (incrementing),
         `depends_on: [<last-batch-id>]`, proposed `files`,
         `ac_mapping: []` (patch-batches don't map to ACs by design;
         they're remediation, not feature), explicit `execution_mode`, and
         rationale. Default toward `proof_first` when the finding is a
         missing check or behavioural proof. Use `change_first` only under
         the same guardrails as stage 3.
         - Patch planning is Builder-owned. Treat reviewer output as evidence
           only; Builder derives files, dependencies, `execution_mode`, and
           rationale from the ledger plus the code before user confirmation.
         - Write the Builder-owned proposal to a scratch file and run
           `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts <patch-proposal-path> --patch-proposal <ledger-path>`.
           The helper must validate exact fields, concrete paths,
           ledger-backed dependencies, exactly one patch batch, files already
           in the confirmed ledger scope unless `new-file-patch-exception:`
           is present, high-risk new files only when
           `high-risk-new-file-patch-exception:` is present,
           `execution_mode`, `acceptance_tests`, patch `ac_mapping: []`, and
           `change_first` guardrails before the proposal reaches the user.
         - Print the validated patch-batch proposal and ask the user to
           confirm the files, dependencies, execution mode, and rationale.
         - On `n`, stop and discuss.
         - On `y`, append the confirmed helper output row to `## Batches`,
           mark its status `pending` if the helper output did not already do
           so, recompute `batch_contract_digest` with
           `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --batch-contract-digest <ledger-path>`,
           then return to stage 4 (batch-loop) to converge it.
         - When the patch-batch converges, update the original
           `batch_id: final` finding row in `## Findings data` to
           `status: fixed` with `resolution: patch-batch <id>` (or
           `resolution: commit <sha>` when the commit is recorded in a
           terminal ledger batch) before evaluating the stage 5 exit
           condition.
       - If finding's fix touches >2 files → fail-stop and ask the user to
         re-plan. `frontmatter.status = blocked`,
         `blocked_reason: final-review-needs-replan`.
     - Apply the same iteration cap, `same-signature-twice` hatch, and
       `finding-count-rises` hatch used by the batch inner loop, keyed by
       final finding signature across patch-batch attempts.
     - After all patch-batches converge, re-invoke `/ce-code-review` from
       the top of stage 5.

5. When ce-code-review returns zero open P0/P1, run
   `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --assert-no-open-p0p1 <ledger-path>`.
   Then close final-review P2 rows
   as `status: deferred-P2` and final-review P3 rows as
   `status: deferred-P3`, preserving their summaries and signatures. Set
   frontmatter `final_reviewed_at` to the current ISO 8601 timestamp. Update
   the rendered findings table, re-run `--validate-findings`, commit the
   ledger, then advance to stage 6. If final review found zero findings and
   the table would not otherwise change, the `final_reviewed_at` frontmatter
   update is the required final-review checkpoint.

**Exit condition:** `frontmatter.final_reviewed_at` is set; `## Findings data`
rows with `batch_id == final` all have status `fixed`, `accepted-risk`,
`deferred-P2`, or `deferred-P3`; working tree clean.

### Stage 6: `ship`

**Inputs:** Clean working tree (everything committed by batch-loop and
final-review fix cycles).

**Actions:**

1. Run the target repo's local checks if they exist. Resolve checks in this
   order:
   - Repo or package runbooks and nearest `AGENTS.md` / `CLAUDE.md`.
   - MCP runners when available, always with `response_format: "json"`:
     `bun_runTests` for tests, `tsc_check` for type checks, and
     `biome_lintCheck` / `biome_formatCheck` for lint or format gates.
   - Repo-specific package scripts or wrappers when an MCP runner is
     unavailable or does not fit the package.
   - Raw shell commands such as `bun test`, `tsc --noEmit`, or `biome check`
     only as the last fallback.
   MCP runner path rejection is a valid "does not fit" case when the file or
   repo is outside the active harness repository, such as runbook helper tests
   under `~/.claude/runbooks/issue-to-pr/` or disposable smoke repos under
   `/tmp`. Some MCP runner schemas also have no `cwd`, so they cannot target
   a scratch repo that is not the active harness repo. In those cases, shell
   fallback is expected and allowed. Record the rejected runner and the shell
   command that replaced it.
   Record each check name, command or runner, exit code, and summary in the
   ledger Notes section. If any check fails, route the failure as if it were
   a P0 finding from `ce-correctness-reviewer` (signature:
   `local-check-failure-<check-name>`, `batch_id: final`). Do not fix in
   stage 6. Write the finding to `## Findings data`, return to stage 5, and
   run `--validate-findings`. Commit the ledger checkpoint before rerouting
   so stage 5 starts from a clean tree. Resolve the finding through the
   validated patch-batch path. After that patch-batch converges, run a fresh
   final-review pass before entering stage 6 again.

2. **Ship path.** Standard mode is mandatory for real repos: run
   `gh pr view --json number,url,state 2>/dev/null`, then invoke
   `/ce-commit-push-pr`.
   - If an open PR exists for the current branch: invoke
     `/ce-commit-push-pr` in description-update mode (it appends or
     replaces sections in the existing PR body rather than creating a new
     PR).
   - If no PR exists: invoke `/ce-commit-push-pr` in create-PR mode.
   - Direct `git push` plus `gh pr create` is allowed only in
     `smoke-direct` mode. This mode is constrained to disposable smoke-test
     repos where the user explicitly asked to keep the smoke small. Before
     using it, verify the target repo and checkout path are disposable, set
     ledger frontmatter `ship_mode: smoke-direct`, and record the reason in
     Notes. If any of those checks are uncertain, use standard mode.

3. After `/ce-commit-push-pr` returns, or after direct smoke ship completes,
   re-run `gh pr view --json number,url,state` to confirm the PR URL. Record
   it in ledger frontmatter as `pr_url`.

4. Append a `## Residual Review Findings` section to the PR body. List
   every P2 finding with `status: deferred-P2`, formatted as
   `- <persona>: <summary> (<signature>)`. If >5 P3 findings exist, append
   a one-liner: `N P3 advisory findings logged in ledger.`. This heading
   matches the one /lfg uses, so the PR body shape is consistent across
   both autopilot paths.

5. Set `frontmatter.status = shipped`.

6. Commit and push the final ledger update containing `pr_url`, residual
   findings, `ship_mode`, and `status: shipped`. Before committing, require
   `git diff --name-only`, `git diff --cached --name-only`, and
   `git ls-files --others --exclude-standard` to contain only the per-issue
   ledger path, or be empty. Stage and commit with an explicit ledger
   pathspec, never a broad add or broad commit. Any other changed, staged, or
   untracked path creates a `local-check-failure-final-ledger-commit` P0
   finding and returns to stage 5. After committing, assert
   `git show --name-only --format= HEAD` contains only the per-issue ledger
   path before any push. If this changes the PR body contents, update the PR
   body again. Echo the final ledger inline.

**Exit condition:** Ledger frontmatter has `pr_url`; `status: shipped`;
working tree clean; final ledger update pushed. Goal met.

---

## Persona selector

After every Builder commit, compute the conditional persona list from the
diff (`git diff HEAD~1 --name-only` plus the file contents). When in doubt,
dispatch (false-positives waste tokens; false-negatives miss bugs).

| Diff signal | Persona dispatched |
| --- | --- |
| Paths or changed content matching `auth`, `session`, `token`, `password`, `crypto`, `oauth`, `sso`, `permission`, `acl`, `rbac`, `csrf` | `ce-security-reviewer` |
| Paths matching `migrations/`, `prisma/schema.prisma`, `schema.rb`, migration `*.sql` files | `ce-data-migrations-reviewer` |
| Any `index.ts`/`index.js` at a package boundary (re-exports), OpenAPI/Swagger spec, GraphQL schema | `ce-api-contract-reviewer` |
| Files with `bench`, `perf`, `virtualis` in path, OR diff contains loop vocabulary on large-N data | `ce-performance-reviewer` |
| Diff touches retry, circuit-breaker, queue, timeout, error-handling middleware | `ce-reliability-reviewer` |
| Files matching `*.swift`, `*.m`, `*.mm`, or paths under `ios/` | `ce-swift-ios-reviewer` |
| Files matching `*.rb`, `app/models/`, `app/controllers/`, `config/routes.rb` | `ce-dhh-rails-reviewer` AND `ce-kieran-rails-reviewer` |
| Files matching `*.tsx` AND touching React hooks/state AND containing race-shaped vocabulary (debounce, throttle, abort, signal, effect cleanup) | `ce-julik-frontend-races-reviewer` |
| Files matching `*.py` | `ce-kieran-python-reviewer` |
| Files matching `*.ts`/`*.tsx` AND no other language reviewer fired | `ce-kieran-typescript-reviewer` |
| The PR (if pre-existing) has prior review comments OR the issue body links a prior PR | `ce-previous-comments-reviewer` |

## Inner loop

Inside `batch-loop` for each batch:

```mermaid
flowchart TD
  IMPL["Builder initial implementation commit<br/>(scoped to batch.files)"] --> P["Compute persona set:<br/>always-on + adversarial + diff-conditional"]
  P --> V["Dispatch personas in parallel<br/>(all read-only)"]
  V --> F["Classify findings:<br/>write to ## Findings data"]
  F --> G{"Open P0/P1<br/>findings == 0?"}
  G -->|yes| C["Mark batch status: converged.<br/>Auto-close P2/P3.<br/>Exit inner loop."]
  G -->|no| E{"Escape hatch<br/>triggered?"}
  E -->|yes| H["Stop. Surface to user.<br/>Mark batch: blocked-for-user."]
  E -->|no| CAP{"Iteration<br/>< 5?"}
  CAP -->|no| H
  CAP -->|yes| S["Builder fix commit<br/>(one P0/P1 finding)"]
  S --> P
```

**Inner-loop iteration cap: 5.** After 5 Builder commits in one batch, stop
and ask the user.

**Builder rules** (apply every iteration):

1. **Scope discipline.** Builder only edits files in the batch's `files`
   list. Editing outside that list triggers the `public-API-change` escape
   hatch (if the out-of-scope file is a public-API surface) OR a "stop and
   ask" for any other out-of-scope edit. Orchestrator-owned ledger lifecycle
   commits are separate from Builder commits and may touch only the per-issue
   ledger path.
2. **Initial implementation commit.** The first Builder commit for a pending
   batch implements the confirmed batch goal under the batch's
   `execution_mode`. Conventional commit format:
   `feat(issue-{issue-number}): implement <batch-id>` (use a more accurate
   conventional type such as `fix`, `docs`, or `chore` when the batch clearly
   warrants it). Body lists the batch id, AC mapping, and acceptance checks.
3. **One finding per fix commit.** After validation has produced findings,
   each Builder fix commit addresses exactly one P0/P1 finding by signature.
   Conventional commit format:
   `fix(issue-{issue-number}): <signature>`. Body lists the finding id and
   persona.
4. **Follow `execution_mode`.** The confirmed ledger chooses the execution
   discipline. Builder follows it or fail-stops if the contract is unsafe or
   stale after reading the files:
   - `tdd`: write one failing public-interface test for the next observable
     behaviour, make the smallest implementation change to pass, then repeat.
     Use this only when the batch has a clear public interface and observable
     behaviour that can fail before implementation. Do not write all tests
     first. This is a local execution discipline. Invoking a host `tdd` skill
     is optional when available, not required.
   - `proof_first`: write the target-state proof or characterization check
     before the change. This is for renames, migrations, scaffolds,
     compatibility preservation, and governance checks where a classic red
     test may be artificial.
   - `change_first`: apply the smallest scoped change, then run the batch's
     acceptance checks. Use by default only for docs-only paths where a red
     test or proof would be artificial. If the batch touches non-doc paths,
     Builder must fail-stop unless the ledger rationale is
     `out-of-scope: investigation-required` or starts with
     `change_first-exception:`. If the batch touches high-risk paths,
     Builder must fail-stop unless the ledger rationale starts with
     `high-risk-change_first-exception:`.
5. **Pin behaviour first.** Where a finding is "test missing", or where
   `execution_mode` is `tdd`, Builder writes the behaviour test first (red),
   then the fix (green).
6. **Tautological-test escape hatch.** If a persona's fix recommendation
   would produce a test that only restates implementation, Builder writes
   a different test that pins observable behaviour, and notes the
   deviation in the commit body.
7. **Read before writing.** Builder reads every file in the batch's
   `files` list before the first edit.

**Validator invocation and rules:**

1. Resolve each persona skill name against the host's available-skills list
   before dispatching. Use the exact listed name, including plugin namespace
   when present.
2. Pass each persona the batch id, goal, files, `execution_mode`,
   acceptance tests, AC mapping, current diff, and relevant ledger findings.
3. Ask each persona to return this envelope:
   `{"reviewer":"<persona>","findings":[],"residual_risks":[],"testing_gaps":[]}`.
   Before writing the ledger, normalize the response:
   - `findings: []`, `{"findings":[]}`, and the full envelope with an empty
     `findings` array all mean no rows from that persona.
   - Extra envelope metadata is not copied into `## Findings data`. Only
     ledger-ready findings are copied.
   - A non-empty finding is ledger-ready only when it has `id`, `batch_id`,
     `signature`, `persona`, `severity`, `status`, `summary`, and
     `resolution`.
   - Missing `findings`, non-array `findings`, malformed JSON or YAML, or a
     partial finding is malformed output. Rerun that persona once with the
     envelope contract. If it is still malformed, treat it as unavailable per
     rule 5 and record the malformed shape in Notes.
   Write normalized rows to `## Findings data` first, then render the
   `## Findings` table from that data. If every persona has empty findings,
   keep `findings: []`.
4. Finding severity must be `P0`, `P1`, `P2`, or `P3`. Finding status must
   be `open`, `fixed`, `accepted-risk`, `deferred-P2`, `deferred-P3`,
   `out-of-scope-for-this-issue`, `ADR-contradicts-<id>`, or `superseded`.
   An open P0/P1 means `severity` is `P0` or `P1` and `status` is `open`.
   All convergence gates read this predicate from `## Findings data`, not
   from the rendered table.
   Run
   `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --validate-findings <ledger-path>`
   after writing findings and before marking any batch converged.
   Run
   `bunx tsx ~/.claude/runbooks/issue-to-pr/decompose.ts --assert-no-open-p0p1 <ledger-path>`
   before any convergence or ship transition that requires zero open P0/P1.
5. If a persona is unavailable, record it in Notes and continue with the
   remaining required personas. If fewer than the always-on personas can run,
   fail-stop and ask whether to use `/ce-code-review mode:report-only` as the
   validation fallback for that batch.
6. Personas are read-only by contract. If a persona's output suggests a
   fix, the runbook ignores the suggestion text; only the finding is
   recorded.
7. Severities (P0/P1/P2/P3) come from the persona's own rubric. The
   runbook does not re-rank.
8. P2 and P3 findings are auto-closed at batch convergence as
   `deferred-P2` / `deferred-P3`. They do NOT block the inner loop.

## Escape hatches

The inner loop stops early (before iteration cap) if any of these trigger:

| Hatch | Trigger | Response |
| --- | --- | --- |
| `ADR-contradicts-<id>` | A persona's finding cites a target-repo ADR and Builder's fix would violate it | Stop, summarise the conflict, ask user. Possible outcomes: revise the ADR, change the approach, accept-risk. |
| `public-API-change` | Builder's fix would change a re-exported symbol's signature, OR touch a file Builder was not authorised to edit (out-of-scope edit on a public surface) | Stop, ask user to confirm the API change is intentional. If yes, widen the batch's `files` list and proceed; if no, revert. |
| `execution-mode-mismatch` | Builder discovers the confirmed `execution_mode` cannot safely apply after reading the files, such as `tdd` without an observable public interface or `change_first` touching behaviour without an explicit exception rationale | Stop, ask user to change the batch mode, add an explicit exception, or re-plan. |
| `same-signature-twice` | A finding with the same `signature` was just closed in iteration N-1 and re-emerged in iteration N | Stop. The Builder is oscillating. Ask user to reframe the finding or accept-risk. |
| `risk-high-finding` | An open P0/P1 sits on a high-risk batch (see README, `## Risk classification`) | Stop before Builder attempts a fix. Ask user to confirm the fix approach. |
| `finding-count-rises` | The number of open P0/P1 findings is higher at iteration N than at iteration N-1 (Builder's fix introduced more problems than it solved) | Stop. Ask user. Likely indicates wrong approach. |

Each hatch fire writes a `## Notes` row to the ledger. Accepted-risk sets
`final_verdict: accepted-risk`; other user-blocked outcomes set
`final_verdict: blocked-for-user`.

## ce-plan addendum

When invoking `/ce-plan` in stage 2, append the following text after the
issue body and the ledger's `## Acceptance criteria` section:

````
## Structured-output requirement (issue-to-pr workflow)

The ledger's `## Acceptance criteria` section contains N items (extracted
from the source issue and confirmed by the user at stage 1). Produce ONE
Implementation Unit per AC by default, in the same order. Each unit's
`goal` field should restate the AC. Each unit's `acceptance_tests` field
should encode "AC <i> holds: <verifiable behaviour>" - typically the AC
text plus a test scenario that would prove it.

Each unit MUST include `execution_mode`, choosing exactly one. This is a
candidate execution contract: stage 3 validates and asks the user to confirm
it before Builder may act on it.

- `tdd`: feature or bug-fix behaviour where the public interface is clear
  enough to write the next failing test before implementation.
- `proof_first`: migration, rename, scaffold, compatibility, or
  governance work where the right first move is a target-state proof or
  characterization check before the change.
- `change_first`: docs-only work where a red test or proof would be
  artificial. Still include acceptance checks. For any non-doc path, include
  `rationale: "out-of-scope: investigation-required"` for investigation
  placeholders, or a non-empty rationale beginning with
  `change_first-exception:` so stage 3 can ask the user to accept it
  explicitly. For high-risk paths, use a non-empty rationale beginning with
  `high-risk-change_first-exception:` instead.

You MAY split an AC into 2+ units OR merge multiple ACs into 1 unit, but
ONLY when:

- Splitting: the AC requires changes in unrelated files that would
  otherwise fail the one-finding-one-commit rule (e.g. "must fail closed
  on missing config" needs the closed-fail path AND the test in different
  files).
- Merging: two ACs live in the same single file with inseparable tests
  (e.g. AC1 "reads X" and AC2 "writes X" both inside one module).

For any split, merge, investigation placeholder, or `change_first` exception,
add a one-line rationale to the unit's body explaining why. Split/merge
rationales do not authorize `change_first` on non-doc paths; non-doc
`change_first` still needs one of the explicit prefixes above, and high-risk
paths need the high-risk prefix. Stage 3 will surface these for user confirm.

Emit each unit's machine-readable shape as a fenced YAML code block
immediately after that unit's prose, using this exact schema:

```yaml
id: <stable-slug>
name: <Title from the Implementation Unit heading>
goal: <one-sentence outcome, ideally the AC verbatim>
files:
  - <repo-relative path>
  - <repo-relative path>
depends_on: []  # or list of ids; emit [] explicitly when none
execution_mode: tdd  # tdd | proof_first | change_first
acceptance_tests:
  - "AC <i> holds: <verifiable behaviour>"
ac_mapping:
  - <i>   # AC index (1-based) this batch satisfies; list multiple if merged
rationale: null  # string only for split/merge, placeholders, or change_first exceptions
```

The `ac_mapping` field is consumed by `decompose.ts --validate-ac-coverage`.
Every AC index must appear in at least one batch's `ac_mapping`. If an AC
has no implementation path, emit a unit with `goal: "AC <i>: investigation
required"`, `execution_mode: change_first`, `ac_mapping: [<i>]`, and
`rationale: "out-of-scope: investigation-required"` and surface as a
stage-3 user gate.
````

## Closing a finding without fixing it

Allowed statuses and resolutions:

| Status | Resolution | Meaning |
| --- | --- | --- |
| `fixed` | `commit <sha>` or `patch-batch patch-NNN` | The finding was fixed by a reachable Builder commit recorded in a terminal ledger batch, or a terminal patch-batch with reachable Builder commits. |
| `accepted-risk` | `accepted-risk: <reason>` | User explicitly accepted the finding; goes into PR body as a known-issue note. |
| `deferred-P2` | `deferred-P2` | Auto-closed at batch or final-review convergence (P2 severity). Surfaced in PR body. |
| `deferred-P3` | `deferred-P3` | Auto-closed at batch or final-review convergence (P3 severity). Logged only. |
| `out-of-scope-for-this-issue` | `out-of-scope-for-this-issue: <reason>` | The finding is real but belongs to a different issue. User creates the follow-up issue and notes its number here. |
| `ADR-contradicts-<id>` | `ADR-contradicts-<id>` | Finding would violate an ADR. Closed without fix. |
| `superseded` | `superseded-by-<finding-id>` | Same signature recurred; the latest open row supersedes this one. The referenced finding id must exist, be open, share the same signature, have equal-or-higher severity, and must not be itself. |

## /loop fallback

If `/goal` is unavailable, use:

```
/loop 60 Follow ~/.claude/runbooks/issue-to-pr/issue-to-pr.md. Target issue
is {issue-number} in {target-repo}. Re-read the runbook and the per-issue
ledger at docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md at the
start of every turn. Walk the six stages in order. Echo the ledger
frontmatter + batches YAML + findings data + findings table inline at end of
every turn. Stop when ledger frontmatter status is `shipped` or `blocked`.
```
