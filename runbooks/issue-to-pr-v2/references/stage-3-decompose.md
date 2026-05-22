# Stage 3: decompose reference

**v1 source anchor:** `runbooks/issue-to-pr/issue-to-pr.md` L514-681; Stage 3
Contract Review behavior is sourced from
`docs/brainstorms/2026-05-21-issue-to-pr-builder-sub-agent-requirements.md`.

**Read trigger:** open this reference when Stage 2 has committed the plan
path and the orchestrator is about to invoke the decompose helper, or when
resuming a Stage 3 turn before `batch_contract_confirmation_status: confirmed`
is durable. See also:
[ledger-and-helper.md](ledger-and-helper.md),
[findings-and-validators.md](findings-and-validators.md),
[stage-4-batch-loop.md](stage-4-batch-loop.md).

## Inputs

- Plan document from Stage 2 (`frontmatter.plan_path`).
- AC list in ledger with durable confirmation state
  `acceptance_criteria: confirmed`.

## Helper context

All Stage 3 helper commands must run from the **target repo root**. This keeps
commit reachability, repo-relative path validation, and ledger checks pointed
at the target repository rather than the installed runbook checkout. The
canonical helper invocation path and the cwd-correctness rule live in
[ledger-and-helper.md](ledger-and-helper.md#helper-execution-context-v1-l314-337).

The bare command form `decompose.ts <plan-path>` below stands in for the v1
invocation `bun ~/.claude/runbooks/issue-to-pr/decompose.ts <plan-path>` until
U3/U4 land the v2 `cli.ts` surface; the helper contract is unchanged.

## Actions

1. Invoke the decompose helper: `decompose.ts <plan-path>` (per the Helper
   context note above, this stands in for the v1 invocation
   `bun ~/.claude/runbooks/issue-to-pr/decompose.ts <plan-path>` until U3/U4
   land the v2 `cli.ts` surface).
   Output is a YAML batches block on stdout; errors are non-zero exits with a
   parse-error message on stderr.
2. On non-zero exit, fail-stop with the parse error verbatim.
   `status: blocked`, `blocked_reason: decompose-parse-error`.
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
     allowed by default; non-doc generated config, mechanical changes, runtime
     changes, and investigation placeholders must carry an explicit rationale
     prefix so the Stage 3 user gate can accept them deliberately.
4. **Validate AC coverage.** Invoke
   `decompose.ts <plan-path> --validate-ac-coverage <ledger-path>`. Every AC
   index (1..N) in the ledger's `## Acceptance criteria` section must appear
   in at least one batch's `ac_mapping`. Any AC not covered triggers fail-stop
   with the canonical message in the v1 source.
5. **Surface rationales.** If any batch has a non-null `rationale` field,
   print it alongside that batch in the confirm prompt.
6. Compute candidate digests for the plan file, the ledger's
   `## Acceptance criteria` section, and the candidate batch contract:
   - `decompose.ts --plan-digest <plan-path>`
   - `decompose.ts --ac-digest <ledger-path>`
   - `decompose.ts <plan-path> --candidate-contract-digest`
7. **Run Contract Review before batch confirmation.** Dispatch a read-only
   Contract Reviewer with the authored plan file path and content, the
   user-confirmed AC list, the parsed candidate DAG, the candidate contract
   digest, and the v1 rubric (catch plan/DAG drift, missing AC coverage not
   visible to the helper, unsafe dependencies, stale file ownership,
   mode/rationale drift, and batch boundaries that would push plan-wide
   decisions into Builder Preflight).

   Default to one Contract Reviewer. Run escalated Contract Review only when
   deterministic triggers fire: rename, identity flip, migration, public API,
   auth/data/privacy, many-file changes, or cross-package governance.
   Contract Reviewer returns the existing Validator envelope shape
   `{"reviewer":"<persona>","findings":[],"residual_risks":[],"testing_gaps":[]}`.

   Normalize findings with `batch_id: stage-3`. Open P0/P1 findings block
   Stage 3 and prevent writing candidate batches to the ledger. Set
   frontmatter `batch_contract_confirmation_status: blocked`, record blockers
   in `## Findings data`, render `## Findings`, run
   `decompose.ts --validate-findings <ledger-path>` then
   `decompose.ts --assert-no-open-p0p1 <ledger-path>`.
   If the assertion fails, do not write to `## Batches`; send the plan back
   for revision. When a plan/DAG revision lands, close the Stage 3 blockers
   with `status: fixed` and `resolution: plan-revision <sha>`, reset
   `batch_contract_confirmation_status: pending`, clear `plan_digest` and
   `batch_contract_digest` to null, and preserve or recompute `ac_digest` from
   the current `## Acceptance criteria` section. Then rerun helper parsing,
   AC coverage, digest computation, and Contract Review before asking for
   confirmation again.

   The Stage 3 Contract Review loop has a **five-cycle cap**. Hitting the cap
   fail-stops with `blocked_reason: contract-review-cycle-cap`. P2/P3 Contract
   Review findings are surfaced in the confirmation prompt but do not block
   writing confirmed batches.
8. **Ask for confirmation.** Print the candidate batch list inline at end of
   turn, including each `execution_mode`, any rationale, all three digests,
   and any nonblocking P2/P3 Contract Review findings. Ask the user to
   confirm the exact AC text, DAG, execution modes, and surfaced advisories
   before entering `batch-loop`. On `n`, stop and discuss.
9. On `y`, immediately checkpoint the gate in durable ledger state before any
   later stage can rely on it: set
   `batch_contract_confirmation_status: confirmed`,
   `batch_contract_confirmed_at: <current ISO 8601 timestamp>`, and store the
   confirmed `plan_digest`, `ac_digest`, and `batch_contract_digest` values in
   frontmatter. A resumed agent can regenerate the candidate DAG from
   `plan_path` and compare it with these stored digests using
   `--confirmation-state`. Leave `## Batches` unchanged until the re-check
   passes.
10. Re-run the helper, AC coverage check, and digest recomputation. If any
    digest changed, set `batch_contract_confirmation_status: stale`, do not
    write candidate batches to `## Batches`, print the changed candidate list,
    and ask for confirmation again.
11. After the re-check passes with matching digests, paste the YAML block into
    `## Batches`. Set all batches to `status: pending`. The ledger's
    `## Batches` section is the confirmed execution contract; never write
    candidate batches there before the user confirms the current digest
    triple. Store confirmed digests in frontmatter and keep
    `batch_contract_confirmation_status: confirmed`.
12. Commit before transitioning to Stage 4:
    `chore(issue-{issue-number}): record batch DAG`. Before the commit, run
    `decompose.ts --validate-ledger-batches <ledger-path>` and
    `decompose.ts --batch-contract-digest <ledger-path>`. Then run
    `decompose.ts --confirmation-state <ledger-path>`; it must report
    `acceptance_criteria: confirmed`, `batch_contract: confirmed`, and
    `digests: confirmed`.

## Exit condition

`## Batches` is populated with all batches at `status: pending`; frontmatter
`batch_contract_confirmation_status: confirmed`; every AC covered; user has
confirmed the digest triple, DAG, and execution modes;
`--confirmation-state` reports all three states `confirmed`; working tree
clean.

## Failure modes (v1 L665-681)

- Cyclic DAG → fail-stop, print the cycle, ask user to revise.
  `blocked_reason: cyclic-dag`.
- Implementation Unit with no files → fail-stop.
- Implementation Unit with no acceptance tests → fail-stop.
- Missing or invalid `execution_mode` → fail-stop.
- AC uncovered → fail-stop (step 4).
- Contract Review open P0/P1 findings → record `batch_id: stage-3` findings,
  revise the plan, close with `resolution: plan-revision <sha>`, rerun
  Contract Review.
- Contract Review loop cap hit → fail-stop with
  `blocked_reason: contract-review-cycle-cap`.

## See also

- [ledger-and-helper.md](ledger-and-helper.md) for helper invocation context
  and the batches contract.
- [findings-and-validators.md](findings-and-validators.md) for Validator
  envelope shape consumed by Contract Review and finding closure semantics.
- [stage-4-batch-loop.md](stage-4-batch-loop.md) — consumes the confirmed
  batches DAG.
