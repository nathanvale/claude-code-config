# Stage 6: ship reference

**Contract owner:** this reference owns Stage 6 local checks, residual finding
gate, PR creation, PR URL recording, ship-time Workflow Learning Scan
placement, and shipped metadata checkpointing.

**Read trigger:** open this reference when Stage 5's exit condition has been
met (`frontmatter.final_reviewed_at` is set; all `batch_id == final` rows are
terminal; working tree clean) and the orchestrator is about to run local
checks and the ship path, or when re-entering Stage 6 after a
`local-check-failure-*` finding was rerouted through Stage 5. See also:
[stage-5-final-review.md](stage-5-final-review.md),
[findings-and-validators.md](findings-and-validators.md),
[ledger-and-helper.md](ledger-and-helper.md), and
[workflow-learning-scan.md](workflow-learning-scan.md).

## Inputs

Clean working tree (everything committed by `batch-loop` and final-review fix
cycles). Confirm the ship gate by running
`cli.ts state <ledger-path> --json`: `data.route_id` must be `"ship"`
(implying `final_reviewed_at` is set and `pr_url` is null) and
`data.blocking_gates` must be empty. If `route_id` is `"shipped"` the
run is already terminal; if anything else, route from the returned
envelope instead of forcing Stage 6.

## Actions

1. **Run the target repo's local checks if they exist.** Resolve checks in
   this order:
   - Repo or package runbooks and nearest `AGENTS.md` / `CLAUDE.md`.
   - MCP runners when available, always with `response_format: "json"`:
     `bun_runTests` for tests, `tsc_check` for type checks, and
     `biome_lintCheck` / `biome_formatCheck` for lint or format gates.
   - Repo-specific package scripts or wrappers when an MCP runner is
     unavailable or does not fit the package.
   - Raw shell commands such as `bun test`, `tsc --noEmit`, or `biome check`
     only as the last fallback.

   MCP runner path rejection is a valid "does not fit" case when the file or
   repo is outside the active harness repository (such as installed runbook
   helper tests or disposable smoke repos under `/tmp`). Some MCP runner
   schemas also have no `cwd`, so they cannot target
   a scratch repo that is not the active harness repo. In those cases, shell
   fallback is expected and allowed. Record the rejected runner and the shell
   command that replaced it.

   Record each check name, command or runner, exit code, and summary in the
   ledger Notes section. If any check fails, route the failure as if it were
   a P0 finding from `ce-correctness-reviewer` (signature
   `local-check-failure-<check-name>`, `batch_id: final`). Do not fix in
   Stage 6. Write the finding to `## Findings data`, return to Stage 5, and
   run `--validate-findings`. Commit the ledger checkpoint before rerouting
   so Stage 5 starts from a clean tree. Resolve the finding through the
   validated patch-batch path. After that patch-batch converges, run a fresh
   final-review pass before entering Stage 6 again.

2. **Ship path.** Standard mode is mandatory for real repos: run
   `gh pr view --json number,url,state 2>/dev/null`, then invoke
   `/ce-commit-push-pr`.
   - If an open PR exists for the current branch: invoke `/ce-commit-push-pr`
     in description-update mode (appends or replaces sections in the existing
     PR body rather than creating a new PR).
   - If no PR exists: invoke `/ce-commit-push-pr` in create-PR mode.
   - Direct `git push` plus `gh pr create` is allowed only in `smoke-direct`
     mode. This mode is constrained to disposable smoke-test repos where the
     user explicitly asked to keep the smoke small. Before using it, verify
     the target repo and checkout path are disposable, set ledger frontmatter
     `ship_mode: smoke-direct`, and record the reason in Notes. If any of
     those checks are uncertain, use standard mode.

3. After `/ce-commit-push-pr` returns (or after direct smoke ship completes),
   re-run `gh pr view --json number,url,state` to confirm the PR URL. Record
   it in ledger frontmatter as `pr_url`.

4. **Run the read-only Workflow Learning Scan.** Load
   [workflow-learning-scan.md](workflow-learning-scan.md), scan completed run
   evidence, and record learning metadata only when useful. Validate registry
   candidates with `learnings-registry.ts --validate` and upsert through
   `learnings-registry.ts --upsert`. Use
   `cli.ts scaffold workflow-learnings-empty --json` for empty ledger section
   shape when needed. Do not patch skills, runbook references, CLI/source code,
   docs, target deliverables, or gotchas content during the ship tail.

5. **Append `## Residual Review Findings` to the PR body.** List every P2
   finding with `status: deferred-P2`, formatted as
   `- <persona>: <summary> (<signature>)`. If >5 P3 findings exist, append a
   one-liner `N P3 advisory findings logged in ledger.`. This heading matches
   the one `/lfg` uses, so the PR body shape is consistent across both
   autopilot paths.

6. Set `frontmatter.status = shipped`.

7. **Commit and push the final metadata update.** The update contains `pr_url`,
   residual findings, `ship_mode`, `status: shipped`, and any Workflow Learning
   Scan ledger/registry metadata. Before committing,
   require `git diff --name-only`, `git diff --cached --name-only`, and
   `git ls-files --others --exclude-standard` to contain only the per-issue
   ledger path and Workflow Learnings registry, or be empty. Stage and commit
   with explicit pathspecs, never a broad add or broad commit. Any other
   changed, staged, or untracked path creates a
   `local-check-failure-final-ledger-commit` P0 finding and returns to Stage 5.
   After committing, assert `git show --name-only --format= HEAD` contains only
   the per-issue ledger path and Workflow Learnings registry before any push.
   If this changes the PR body contents, update the PR body again. Echo the
   final ledger inline.

## Exit condition

Ledger frontmatter has `pr_url`; `status: shipped`; working tree clean; final
metadata update pushed. Goal met.

## See also

- [stage-5-final-review.md](stage-5-final-review.md) for the read-only gate
  that local-check failures reroute back through.
- [findings-and-validators.md](findings-and-validators.md) for the
  `local-check-failure-*` finding shape and close-reason semantics.
- [ledger-and-helper.md](ledger-and-helper.md) for the helper command context
  and ledger schema.
- [workflow-learning-scan.md](workflow-learning-scan.md) for ship-time learning
  capture and read-only scan boundary.
