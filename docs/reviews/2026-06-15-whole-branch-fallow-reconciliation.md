# Whole-Branch Fallow Reconciliation

Date: 2026-06-15

Branch: `feat/worktree-worktree-renderer`

Base ref: `main`

Plan: `docs/plans/2026-06-15-003-fix-whole-branch-fallow-reconciliation-plan.md`

## Purpose

Reconcile whole-branch Fallow findings without pulling inherited repo debt into this branch.

Use this note as the durable ledger for introduced findings, inherited context, and owner-batch decisions.

## Branch Snapshot

Tracked dirty files before reconciliation:

| State | Path |
| --- | --- |
| modified | `CONTEXT.md` |
| modified | `docs/plans/2026-06-15-002-feat-cli-branch-station-maps-plan.md` |
| modified | `runtime/cli-command-facade/tests/process-testing.test.ts` |
| modified | `runtime/cli-command-facade/tests/station-map.test.ts` |
| modified | `scripts/command-entrypoint.integration.test.ts` |
| modified | `skills/create-cli/references/cli-command-facade.md` |

Untracked files before reconciliation:

| State | Path |
| --- | --- |
| untracked | `docs/plans/2026-06-15-003-fix-whole-branch-fallow-reconciliation-plan.md` |
| untracked | `runtime/agent-worktree/tests/entrypoint.integration.test.ts` |
| untracked | `skills/skill-feedback/src/branch-station-catalog.test.ts` |
| untracked | `skills/skill-feedback/src/branch-station-catalog.ts` |
| untracked | `skills/skill-feedback/src/branch-station-evidence.ts` |
| untracked | `skills/skill-feedback/src/skill-feedback.integration.test.ts` |
| untracked | `skills/worktree/src/worktree.integration.test.ts` |

Committed branch diff count: 61 files against `main`.

## Fallow Baseline

Whole-branch audit:

| Field | Value |
| --- | ---: |
| run id | `fallow:2026-06-15T08:59:33.649Z:shux3a` |
| mode | `audit` |
| base ref | `main` |
| changed files | 70 |
| total findings | 202 |
| introduced findings | 73 |
| inherited findings | 128 |
| introduced dead-code findings | 31 |
| introduced complexity findings | 19 |
| introduced duplication findings | 23 |
| issue references | 272 |
| addressable introduced issue refs | 32 |
| addressable inherited issue refs | 86 |

Command:

```sh
bun --filter fallow-scripts fallow-runner -- audit --json --root /Users/nathanvale/code/claude-code-config/.worktrees/feat/worktree-worktree-renderer --max-output-bytes 1000000
```

Scoped current-task audit:

| Field | Value |
| --- | ---: |
| run id | `fallow:2026-06-15T08:59:03.563Z:9mjcqt` |
| base ref | `HEAD` |
| changed files | 13 |
| total findings | 25 |
| introduced findings | 23 |
| inherited findings | 2 |
| facade issue refs | 0 |

Command:

```sh
bun --filter fallow-scripts fallow-runner -- audit --json --root /Users/nathanvale/code/claude-code-config/.worktrees/feat/worktree-worktree-renderer --base-ref HEAD
```

Interpretation:

- Whole-branch audit is the PR-prep lens.
- Scoped current-task audit is the facade regression guard.
- Fallow summary reports 73 introduced findings.
- JSON issue references expose 32 introduced refs with path/symbol/action.
- The remaining 41 introduced findings are summary-only duplication/complexity/dead-code groups in this envelope.
- Do not mutate summary-only groups without owner-batch evidence.

## Introduced Owner Counts

| Owner | Action | Addressable refs | Disposition |
| --- | --- | ---: | --- |
| `runtime/cli-command-facade` | `add-tests` | 6 | Resolved by scoped facade guard. |
| `runtime/agent-worktree` | `remove-export` | 6 | Noise; resolver says keep exports. |
| `skills/skill-feedback` | `remove-export` | 7 | Noise; resolver says keep exports. |
| `skills/skill-feedback` | `add-tests` | 1 | Noise; existing station rows cover helper branches. |
| `skills/cli-execution-auditor` | `add-tests` | 12 | Partially real; added targeted tests for parser and asset-shape gaps. |

## Introduced Issue Ledger

| Owner | Action | Location | Symbol | Disposition | Evidence |
| --- | --- | --- | --- | --- | --- |
| `agent-worktree` | `remove-export` | `runtime/agent-worktree/tests/support.ts:89` | `runJsonCli` | noise | `why keep`; refs 2; run `ak3dv8`. |
| `agent-worktree` | `remove-export` | `runtime/agent-worktree/tests/support.ts:114` | `runTextCli` | noise | `why keep`; refs 1; run `utylbl`. |
| `agent-worktree` | `remove-export` | `runtime/agent-worktree/tests/support.ts:134` | `fakeGitRunner` | noise | `why keep`; refs 5; run `8edxaz`. |
| `agent-worktree` | `remove-export` | `runtime/agent-worktree/tests/support.ts:154` | `mainRepoGitOutputs` | noise | `why keep`; refs 1; run `pj39mo`. |
| `agent-worktree` | `remove-export` | `runtime/agent-worktree/tests/support.ts:179` | `linkedRepoGitOutputs` | noise | `why keep`; refs 1; run `5kygq6`. |
| `agent-worktree` | `remove-export` | `runtime/agent-worktree/tests/support.ts:221` | `repoRuntime` | noise | `why keep`; refs 1; run `rgs65o`. |
| `skill-feedback` | `remove-export` | `skills/skill-feedback/src/branch-station-catalog.ts:25` | `SKILL_FEEDBACK_PLANNING_BRANCH_STATION_IDS` | noise | `why keep`; refs 1; run `6adrnx`. |
| `skill-feedback` | `remove-export` | `skills/skill-feedback/src/branch-station-catalog.ts:45` | `skillFeedbackBranchStationCatalog` | noise | `why keep`; refs 2; run `kh2066`. |
| `skill-feedback` | `remove-export` | `skills/skill-feedback/src/branch-station-catalog.ts:183` | `projectSkillFeedbackStationDiscovery` | noise | `why keep`; refs 1; run `woajgb`. |
| `skill-feedback` | `remove-export` | `skills/skill-feedback/src/branch-station-catalog.ts:193` | `findSkillFeedbackBranchStationCatalogDrift` | noise | `why keep`; refs 1; run `g6vkcb`. |
| `skill-feedback` | `remove-export` | `skills/skill-feedback/src/branch-station-catalog.ts:210` | `projectSkillFeedbackStationMap` | noise | `why keep`; refs 2; run `ixsl8z`. |
| `skill-feedback` | `remove-export` | `skills/skill-feedback/src/branch-station-evidence.ts:18` | `projectSkillFeedbackBranchStationEvidence` | noise | `why keep`; refs 1; run `q3q9ii`. |
| `skill-feedback` | `remove-export` | `skills/skill-feedback/src/branch-station-evidence.ts:30` | `listMissingSkillFeedbackBranchStationEvidence` | noise | `why keep`; refs 1; run `xogt5z`. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/auditor.ts:87` | `parseAuditorArgv` | triage-needed | Needs owner-batch review. |
| `facade` | `add-tests` | `runtime/cli-command-facade/src/station-map.ts:277` | `findBranchStationCatalogDrift` | resolved-guarded | Facade scoped audit clean. |
| `facade` | `add-tests` | `runtime/cli-command-facade/src/station-map.ts:492` | `reconcileStatus` | resolved-guarded | Facade scoped audit clean. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/station-map.ts:51` | `runStationMapAudit` | triage-needed | Needs owner-batch review. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/acquire-station-map-worker.ts:16` | `main` | triage-needed | Needs owner-batch review. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/acquire-station-map-worker.ts:97` | `isBranchStationShape` | triage-needed | Needs owner-batch review. |
| `facade` | `add-tests` | `runtime/cli-command-facade/src/station-map.ts:453` | `projectExpectedResult` | resolved-guarded | Facade scoped audit clean. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/auditor.ts:372` | `renderPlainStationMap` | triage-needed | Needs owner-batch review. |
| `facade` | `add-tests` | `runtime/cli-command-facade/src/process-testing.ts:91` | `runCliProcess` | resolved-guarded | Facade scoped audit clean. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/auditor.test.ts:42` | `<arrow>` | triage-needed | Needs owner-batch review. |
| `skill-feedback` | `add-tests` | `skills/skill-feedback/src/skill-feedback.integration.test.ts:366` | `observedResultContractId` | noise | Covered by catalog-driven station rows: data contract path and fallback contract path both exercised. Owner tests passed: `bun --filter skill-feedback-scripts test --coverage`; typecheck passed. |
| `facade` | `add-tests` | `runtime/cli-command-facade/src/station-map.ts:472` | `projectObservedResult` | resolved-guarded | Facade scoped audit clean. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/auditor.ts:357` | `renderPlainAudit` | triage-needed | Needs owner-batch review. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/fixtures/good-station-map-covered/src/fixture.ts:36` | `main` | triage-needed | Needs owner-batch review. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/station-map.ts:132` | `acquireStationMapAssets` | triage-needed | Needs owner-batch review. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/auditor.ts:317` | `runStationMapCommand` | triage-needed | Needs owner-batch review. |
| `facade` | `add-tests` | `runtime/cli-command-facade/src/process-testing.ts:139` | `<arrow>` | resolved-guarded | Facade scoped audit clean. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/acquire-station-map-worker.ts:63` | `findCatalogByShape` | triage-needed | Needs owner-batch review. |
| `cli-execution-auditor` | `add-tests` | `skills/cli-execution-auditor/src/acquire-station-map-worker.ts:77` | `findEvidenceByShape` | triage-needed | Needs owner-batch review. |

## Inherited Context

Inherited issue references are context, not this branch's active queue.

Counts:

| Kind | Count |
| --- | ---: |
| inherited summary findings | 128 |
| inherited issue references | 86 |

No inherited finding in this baseline names a security or data-risk path.

## Owner Batch Order

1. Preserve facade guard.
2. Triage `remove-export` findings with reachability evidence.
3. Triage `skill-feedback` Branch Station pilot.
4. Triage `cli-execution-auditor` Station Map add-test refs.
5. Triage `worktree`, `agent-worktree`, and root sentinel summary-only groups.
6. Triage docs and new-skill summary-only groups.
7. Rerun whole-branch Fallow and scoped facade guard.

## Current Decisions

- Facade `add-tests` refs are resolved for current-task scope.
- Contract and test-support export findings are analyzer noise after `why` resolver evidence proved reachable exports.
- Skill-feedback `observedResultContractId` finding is analyzer noise after owner coverage run and table-driven station evidence.
- CLI execution auditor `add-tests` cluster had real branch gaps in inline argv value handling and Station Map asset acquisition failure states.
- Summary-only introduced findings require owner-batch evidence before code edits.
- Inherited findings remain out of scope unless a later batch proves direct runtime risk.

## Owner Checks

| Owner | Command | Result |
| --- | --- | --- |
| `skills/skill-feedback` | `bun --filter skill-feedback-scripts test --coverage` | Pass: 209 tests. |
| `skills/skill-feedback` | `bun --filter skill-feedback-scripts typecheck` | Pass. |
| `skills/cli-execution-auditor` | `bun --filter cli-execution-auditor-scripts test --coverage` | Pass: 128 tests. |
| `skills/cli-execution-auditor` | `bun --filter cli-execution-auditor-scripts typecheck` | Pass. |
| `skills/worktree` | `bun --filter worktree-scripts test` | Pass: 70 tests. |
| `skills/worktree` | `bun --filter worktree-scripts typecheck` | Pass. |
| `runtime/agent-worktree` | `bun --filter agent-worktree test` | Pass: 62 tests. |
| `runtime/agent-worktree` | `bun --filter agent-worktree typecheck` | Pass. |
| root sentinel | `bun run command-entrypoint:integration` | Pass: 28 tests. |
| docs/new skills | frontmatter description quote check | Pass: `bad-practices`, `cli-execution-auditor`, `worktree`. |
| touched auditor tests | `bunx biome check --diagnostic-level=error ...` | Pass. |

## Final Audit

Whole-branch audit:

| Field | Value |
| --- | ---: |
| run id | `fallow:2026-06-15T09:07:39.173Z:4dlo9k` |
| status | `issues` |
| changed files | 71 |
| total findings | 203 |
| introduced findings | 74 |
| inherited findings | 128 |
| introduced issue refs | 32 |

Scoped current-task guard:

| Field | Value |
| --- | ---: |
| run id | `fallow:2026-06-15T09:07:39.173Z:vm5tdx` |
| status | `issues` |
| base ref | `HEAD` |
| introduced findings | 24 |
| facade issue refs | 0 |

Residual disposition:

- `remove-export` refs: noise; `why` resolver says keep reachable exports.
- Facade `add-tests` refs: resolved in scoped current-task guard.
- Skill-feedback `add-tests` ref: noise; table-driven integration rows cover both contract paths.
- CLI execution auditor `add-tests` refs: real gaps patched where coverage identified actionable branches; remaining refs are private-helper and fixture-heavy coverage noise under current analyzer shape.
- Summary-only duplication/complexity/dead-code groups remain opaque in the JSON envelope; owner checks pass, and no exposed introduced issue refs remain unclassified.
