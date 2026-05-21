---
title: "fix: Stabilize Issue-to-PR Helper Invocation"
type: fix
status: completed
date: 2026-05-21
origin: https://github.com/nathanvale/claude-code-config/issues/28
---

# fix: Stabilize Issue-to-PR Helper Invocation

## Summary

Replace the Issue-to-PR helper invocation contract with direct Bun execution so runbook examples, helper executable metadata, and the focused helper regression harness all use the same stable command shape. This plan keeps the helper's existing validation semantics intact and avoids the broader runbook hardening work tracked by the parent PRD.

---

## Problem Frame

Issue #28 is the first surgical slice from the Issue-to-PR hardening PRD: the deterministic helper path can fail for local tooling reasons because the documented examples and test harness currently depend on the package-runner shape. That makes a helper regression look like a corrupted cache problem instead of a normal focused test result.

---

## Requirements

- R1. All documented Issue-to-PR helper command examples use direct Bun execution for the TypeScript helper instead of `bunx tsx`.
- R2. The focused helper test harness invokes the helper through the same stable command shape expected by the runbook.
- R3. The focused helper regression suite passes without an isolated package-runner cache workaround.
- R4. Existing helper semantics remain unchanged for decomposition, digesting, acceptance-criteria coverage, ledger validation, patch proposals, findings validation, and P0/P1 assertions.
- R5. No new dependency is added.

---

## Scope Boundaries

- This plan does not change the Issue-to-PR workflow architecture, Builder/Validator boundaries, or Stage 4 context-isolation rules.
- This plan does not add a repo-root CLI option, wrapper package script, or new helper command.
- This plan does not convert `decompose.ts` into a package entrypoint; the helper remains a standalone script that can be invoked while the operator is in an arbitrary target repo.
- This plan does not implement the broader parent PRD items for resumable user gates, validation checkpoint commits, final-review patch planning ownership, Builder attempt schema, or compact skill splitting.
- This plan does not change the generic preference for `bunx` when package execution is actually needed; it only replaces the Issue-to-PR helper path because this helper is a local TypeScript file that Bun can run directly.
- This plan does not require direct edits to installed home copies of the runbook; repo source remains authoritative, and the normal install/symlink path carries it into the installed location.
- This plan does not repair a broken installed runbook symlink. Implementation may check the installed path read-only and report drift, but symlink repair is outside this issue.
- This plan does not update adjacent ledger-template links or other doc hygiene unless they directly block helper command examples or focused helper tests.

### Deferred to Follow-Up Work

- Parent issue #27 continues to own the remaining surgical hardening slices after helper invocation reliability is stable.
- Any future decision to support an explicit target repo root remains separate from this helper invocation stabilization slice.

---

## Context & Research

### Relevant Code and Patterns

- `runbooks/issue-to-pr/issue-to-pr.md` contains every executable helper example in the stage protocol and final-review flow. These examples currently use the `bunx tsx` package-runner shape.
- `runbooks/issue-to-pr/README.md` describes the ledger digest helper commands and should stay aligned with the stage protocol.
- `runbooks/issue-to-pr/decompose.ts` is the TypeScript helper. Its current shebang still names `bunx tsx`, which leaves a fragile executable path even after prose examples change.
- `runbooks/issue-to-pr/decompose.test.ts` centralizes focused helper execution in `runDecompose`, currently spawning `bunx tsx` for every semantic test.
- `context/known-issues.md` records Bunx cache corruption as an existing local failure mode, which matches the reliability pain behind issue #28.

### Institutional Learnings

- `docs/reviews/2026-03-23-prompt-system-review.md` says shared cross-harness surfaces should express required behavior without stale runtime-specific mechanics. Here, the Issue-to-PR runbook should name the stable helper command contract once and reuse it consistently.
- `docs/adr/0001-stage-4-context-isolation.md` preserves Builder/Validator context boundaries. This plan intentionally avoids those architectural surfaces.

### External References

- Bun docs via Context7 (`/oven-sh/bun`) confirm Bun can execute TypeScript files directly with `bun <file>` or `bun run <file>`.
- Bun docs via Context7 (`/oven-sh/bun`) document `#!/usr/bin/env bun` as the shebang for scripts intended to run directly with Bun.

---

## Key Technical Decisions

- Standardize on `bun <helper-path>` for the runbook command contract: it is the least ambiguous direct-runtime form, is documented for TypeScript files, and keeps examples readable without adding a package script or wrapper.
- Preserve the installed helper path in operator-facing runbook examples: the Issue-to-PR workflow executes from arbitrary target repos, so runbook prose should keep pointing at the installed runbook helper rather than a repo-relative helper path.
- Update the helper shebang to `#!/usr/bin/env bun`: the helper should not retain a package-runner executable path once the documented contract moves to direct Bun.
- Keep helper arguments unchanged: this slice changes how the helper process starts, not what `decompose.ts` accepts or emits.
- Preserve helper output intentionally: usage text, stderr prefixes, digest output, YAML output, and validation messages should not change unless implementation exposes an existing incidental string that the semantic tests do not rely on.
- Use the existing focused helper suite as the semantic guardrail: the suite already covers decomposition, digesting, AC coverage, ledger validation, patch proposals, findings validation, and P0/P1 assertions through the helper boundary.

---

## Open Questions

### Resolved During Planning

- Should this introduce a package script or wrapper? No. Issue #28 asks for direct Bun execution and no new dependency; a wrapper would create another command surface to keep in sync.
- Should the command contract use `bun <helper-path>` or `bun run <helper-path>`? Use `bun <helper-path>` in docs and tests. It is the least ambiguous direct-runtime form while still avoiding reliance on shell executable bits.
- Should runbook examples use the installed helper path or the repo-local helper path? Use the installed helper path in runbook examples and the repo-local helper path in tests. The runbook executes from target repos, while the tests execute against this repo's source file.
- Should the implementation replace every Issue-to-PR helper command example, or only Stage 3 examples? Replace every executable Issue-to-PR helper command example, including digest, validation, patch-proposal, final-review, and Stage 3 examples.
- Should bare helper references become full direct-Bun examples? No. Descriptive shorthand can remain terse; only executable command examples need the full runner shape.
- Should installed home copies be updated directly? No. Update repo source only; the installed runbook should reflect source through the normal install/symlink path.
- Should implementation verify the installed runbook path? Yes, read-only. It may check whether the installed helper path resolves to repo source and report mismatch, but must not repair symlinks in this issue.
- Should the focused test harness spawn `bun` from PATH? Prefer the current Bun executable path exposed by the runtime, falling back to `bun` only when that path is unavailable. This still proves direct Bun execution while avoiding PATH mismatch inside tests.
- Should the plan require a test that asserts the exact process argv vector? No. That would over-couple the tests to harness implementation; the process-boundary suite plus search verification is enough.
- Should `decompose.ts` become a package entrypoint? No. It should remain a standalone script so the Issue-to-PR workflow can invoke the installed helper while operating inside arbitrary target repos.
- Should the ledger template's installed README link be updated while touching helper docs? No. That is adjacent doc hygiene, not part of helper invocation reliability, unless implementation finds it directly blocking command examples or tests.
- Should direct Bun execution change where commands run from? No. Helper commands still run from the target repo root; direct Bun changes the runner, not the cwd contract that digest and ledger checks depend on.
- Should this slice change helper semantics or command arguments? No. Existing command modes and output contracts remain unchanged.
- Should helper output text be preserved? Yes, with the practical wording "no intentional output changes." Exact usage text, stderr prefixes, digest output, YAML output, and validation messages are part of the helper boundary unless implementation exposes an incidental string that existing tests do not rely on.
- Should implementation smoke-test the installed helper path? Yes, if the installed symlink is healthy. Run one lightweight read-only direct-Bun helper command through the installed path from the repo root to prove the documented command shape starts.
- Should the installed-path smoke cover every helper mode? No. The focused helper suite covers helper modes semantically through repo-local source; the installed-path smoke only proves command-contract wiring.
- Should implementation update this plan if the final command shape differs? Yes. If execution discovers that Bun requires a materially different stable command shape, update this plan before or alongside the code change so the decision trail stays honest.
- Should documentation and test-harness work remain separate units? Yes. The runbook docs define the helper command contract first; the harness then proves that same contract without mixing docs review and test-harness review.
- Should U2 depend on U1? Yes. The test harness should match the documented helper command contract, so the docs contract is the dependency.
- Should U1 use `change_first` and U2 use `proof_first`? Yes. Docs-only command examples fit `change_first`; harness behaviour-preservation work uses `proof_first` because the existing focused suite is the proof boundary.

### Deferred to Implementation

- Exact formatting of multi-line runbook examples may move during editing as long as every helper example uses the same direct Bun command shape.
- If implementation discovers additional generated or installed copies of the Issue-to-PR runbook, update only the repo-owned source or generated artifact that this repo normally maintains. Do not chase unrelated local cache copies.

---

## Implementation Units

### U1. Replace Runbook Helper Command Examples

**Goal:** Make every documented Issue-to-PR helper example use direct Bun execution and remove the fragile package-runner pattern from the runbook command contract.

**Requirements:** R1, R5

**Dependencies:** None

**Files:**
- Modify: `runbooks/issue-to-pr/README.md`
- Modify: `runbooks/issue-to-pr/issue-to-pr.md`

**Approach:**
- Replace helper examples that invoke `decompose.ts` through `bunx tsx` with the direct Bun command contract.
- Keep all helper paths, flags, arguments, and surrounding stage semantics unchanged.
- Preserve the installed helper path in runbook examples; only the runner changes from the package-runner shape to direct Bun.
- Cover every executable Issue-to-PR helper command example, not only Stage 3. Digest, validation, patch-proposal, final-review, and stage-transition examples should not drift apart.
- Leave non-executable shorthand references alone when they are describing helper modes rather than instructing an operator to run a command.
- Avoid changing unrelated `bunx` references outside the Issue-to-PR helper path, because package execution remains valid when the command is actually a package executable.
- Preserve and, where useful, restate the runbook's target-repo-root expectation; this slice only changes the helper runner, not where commands execute.

**Patterns to follow:**
- Existing command-example style in `runbooks/issue-to-pr/issue-to-pr.md`.
- Ledger digest descriptions in `runbooks/issue-to-pr/README.md`.

**Test scenarios:**
- Test expectation: none -- this unit changes documentation examples only. Verification is by targeted text search and markdown review.
- Happy path: every `decompose.ts` command example in the runbook uses direct Bun execution with the same installed helper path and existing flags.
- Edge case: descriptive shorthand references to helper modes remain concise and are not expanded into full command examples.
- Integration: command examples still communicate that helper commands execute from the target repo root, not from the installed runbook directory.
- Edge case: generic `bunx` guidance elsewhere in the repo is left alone when it refers to package execution rather than this local TypeScript helper.
- Integration: README ledger-format examples and stage-protocol examples describe the same command shape.

**Verification:**
- Search confirms no Issue-to-PR helper example still uses `bunx tsx`.
- A reviewer can compare the old and new examples and see only the runner changed; helper path, flags, and arguments are preserved.
- If the installed runbook symlink is healthy, one lightweight read-only helper command starts through the installed path with direct Bun execution.

```yaml
id: replace-runbook-helper-command-examples
name: Replace Runbook Helper Command Examples
goal: "All documented Issue-to-PR helper command examples use direct Bun execution instead of the package-runner shape."
files:
  - runbooks/issue-to-pr/README.md
  - runbooks/issue-to-pr/issue-to-pr.md
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "Issue-to-PR helper examples use direct Bun execution for every decompose.ts command."
  - "No unrelated package-execution guidance is rewritten as part of this slice."
ac_mapping:
  - 1
  - 5
rationale: null
```

### U2. Align Helper Executable Metadata and Test Harness

**Goal:** Make the helper file and focused regression harness use the same direct Bun command shape as the runbook while preserving helper behavior.

**Requirements:** R2, R3, R4, R5

**Dependencies:** U1

**Files:**
- Modify: `runbooks/issue-to-pr/decompose.ts`
- Modify: `runbooks/issue-to-pr/decompose.test.ts`
- Test: `runbooks/issue-to-pr/decompose.test.ts`

**Approach:**
- Change the helper shebang to Bun so direct execution metadata no longer points at `bunx tsx`.
- Update the test harness's centralized helper invocation to match the runbook command contract.
- Keep the test harness pointed at the repo-local helper file so it proves this repo's source, while matching the runbook's runner shape.
- Prefer the current Bun executable path exposed by the test runtime when spawning the helper, with `bun` as a fallback only if the runtime path is unavailable.
- Keep `runDecompose` as the single test harness entry point so the whole semantic suite exercises the same invocation path.
- Keep `decompose.ts` as a standalone script. Do not introduce package metadata, package scripts, or entrypoints for this slice.
- Do not change parser, digest, validation, patch-proposal, findings, or P0/P1 assertion logic unless a test exposes an invocation-only bug.

**Execution note:** Use the existing focused helper suite as a proof-first guard. If an explicit invocation regression is missing, add the smallest harness-level proof before changing helper behavior.

**Patterns to follow:**
- Existing `runDecompose` helper in `runbooks/issue-to-pr/decompose.test.ts`.
- Existing command-mode tests in `runbooks/issue-to-pr/decompose.test.ts`, which already exercise the helper as a process boundary.
- Bun's documented `#!/usr/bin/env bun` shebang for scripts intended to run through Bun.

**Test scenarios:**
- Happy path: running the focused helper suite invokes `decompose.ts` through direct Bun execution and all existing command-mode tests pass.
- Happy path: plan decomposition still emits batches in topological order and accepts YAML comments.
- Happy path: digest commands still emit stable plan, AC, candidate-contract, and ledger batch-contract digests.
- Happy path: AC coverage validation still accepts fully covered ledgers and rejects missing AC coverage.
- Happy path: ledger batch validation, patch-proposal validation, findings validation, and no-open-P0/P1 assertion behavior remain unchanged.
- Error path: invalid helper usage still exits non-zero and prints the existing usage message.
- Error path: ledger read failures and parse failures still report `decompose:` errors through stderr.
- Integration: the focused helper regression suite passes without setting or relying on an isolated package-runner cache workaround.
- Edge case: the test suite proves direct process-boundary execution without adding a brittle assertion against the exact argv vector.
- Integration: installed-path smoke coverage is limited to command-contract wiring; semantic helper-mode coverage remains in the focused repo-local suite.

**Verification:**
- The focused helper test file passes through the Bun runner MCP or the repo's preferred focused test runner.
- Search confirms `runbooks/issue-to-pr/decompose.ts` and `runbooks/issue-to-pr/decompose.test.ts` no longer contain the helper's old `bunx tsx` invocation path.
- No package dependency files are added or changed for this slice.
- Any installed runbook path check is read-only; a broken symlink is reported rather than repaired.
- If implementation proves a materially different stable command shape is required, the plan is updated before or alongside the code change.

```yaml
id: align-helper-executable-metadata-and-test-harness
name: Align Helper Executable Metadata and Test Harness
goal: "The helper file and focused helper regression harness use the same direct Bun execution path as the runbook, while helper semantics stay unchanged."
files:
  - runbooks/issue-to-pr/decompose.ts
  - runbooks/issue-to-pr/decompose.test.ts
depends_on:
  - replace-runbook-helper-command-examples
execution_mode: proof_first
acceptance_tests:
  - "The helper test harness invokes decompose.ts through the same direct Bun command shape documented in the runbook."
  - "The focused helper regression suite passes without an isolated package-runner cache workaround."
  - "Existing helper semantics for decomposition, digesting, AC coverage, ledger validation, patch proposals, findings validation, and P0/P1 assertions remain unchanged."
  - "No new dependency is added."
ac_mapping:
  - 2
  - 3
  - 4
  - 5
rationale: null
```

---

## System-Wide Impact

- **Interaction graph:** The runbook examples, helper shebang, and focused test harness all converge on one command contract. The helper's argument parsing and output remain unchanged.
- **Error propagation:** Helper failures should continue to surface as existing non-zero process exits with stderr messages; this plan changes process startup, not error wording.
- **State lifecycle risks:** None. The helper still reads plan and ledger files and writes only to stdout/stderr.
- **API surface parity:** The CLI command examples are a documented workflow contract. The test harness must match them so future regressions catch runner drift.
- **Integration coverage:** The focused helper suite crosses the process boundary and is the primary proof that the command contract and helper semantics still line up.
- **Unchanged invariants:** Issue-to-PR stage ordering, ledger schema, acceptance-criteria mapping, digest payloads, patch-proposal validation, findings validation, and Builder/Validator boundaries remain unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A `bunx tsx` helper example is missed in prose | Sweep the Issue-to-PR runbook files with targeted search before verification. |
| Direct helper execution still encounters stale executable metadata in an unexpected path | Update the helper shebang to `#!/usr/bin/env bun` so both documented and direct executable paths point at Bun. |
| The helper test suite changes behavior while changing invocation | Keep changes centralized in the harness and use the existing semantic tests as the regression proof. |
| Generic `bunx` guidance is accidentally rewritten | Scope search-and-replace to Issue-to-PR helper examples, not repo-wide package execution guidance. |

---

## Documentation / Operational Notes

- No migration, rollout, or dependency installation is required.
- After implementation, the useful proof is a boring focused helper regression result rather than a cache workaround.
- If the test runner reports unrelated dirty-tree or generated-output changes, treat them as separate from issue #28 unless they directly come from the helper invocation change.

---

## Sources & References

- **Origin issue:** [#28 Stabilize Issue-to-PR helper invocation](https://github.com/nathanvale/claude-code-config/issues/28)
- **Parent PRD issue:** [#27 PRD: Surgical hardening of the Issue-to-PR runbook](https://github.com/nathanvale/claude-code-config/issues/27)
- **Related brainstorm:** `docs/brainstorms/2026-05-21-issue-to-pr-builder-sub-agent-requirements.md`
- **Related existing plan:** `docs/plans/2026-05-21-001-feat-builder-work-packet-dispatch-plan.md`
- **Runbook docs:** `runbooks/issue-to-pr/README.md`, `runbooks/issue-to-pr/issue-to-pr.md`
- **Helper and tests:** `runbooks/issue-to-pr/decompose.ts`, `runbooks/issue-to-pr/decompose.test.ts`
- **Known issue:** `context/known-issues.md`
- **Bun docs:** Context7 `/oven-sh/bun`, direct TypeScript file execution and Bun shebang guidance
