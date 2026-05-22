# U3 helper internals - slice ledger

**Parent:** issue #51 ("Issue-to-PR v2: Build helper internals behind compatibility shim")
**Plan slice:** U3 in `docs/plans/2026-05-22-002-refactor-issue-to-pr-v2-runbook-plan.md`
**Convergence model:** test-driven (not `/goal`-driven). Each slice's row hits
`green` when its unit tests pass AND the v2 process-boundary characterization
suite (`runbooks/issue-to-pr-v2/decompose.test.ts`) passes byte-for-byte
against the v2 entrypoint. The unit is done when all 5 slices are `green`
and a final `/ce-code-review` pass with TypeScript-focused personas reports
zero new findings.

**Char-suite wiring:** v1's `runbooks/issue-to-pr/decompose.test.ts` is the
authoritative baseline (5,633 lines exercising every flag through stdout /
stderr / exit-code snapshots). U3 copies it to
`runbooks/issue-to-pr-v2/decompose.test.ts` and retargets the entrypoint
path; both suites coexist until U7 retires v1.

**Slice ordering:** topological per plan — `contract` (constants), `digest`
(payload construction + hashing), `ledger` (parsing + integrity),
`validate` (batch / patch / findings rules), then the `decompose.ts`
entrypoint that imports all four. Each slice ships as its own commit during
the work; commits squash to one before opening the PR.

**Issue #51 AC mapping:**

- AC1 (command behavior parity) → S5 entrypoint, gated by char suite
- AC2 (runtime contract values executable) → S1 `lib/contract.ts`
- AC3 (digest stable across lifecycle-only changes) → S2 `lib/digest.ts`
- AC4 (ledger parsing + validation coverage) → S3 `lib/ledger.ts` + S4 `lib/validate.ts`
- AC5 (module-level tests for exports + parsers/validators) → every `*.test.ts`
- AC6 (v2 char suite passes through v2 entrypoint) → S0 char-suite wiring

## Slices

| id | slice | status | unit tests | char suite vs v1 baseline | reviewer pass | resolution |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | runbooks/issue-to-pr-v2/decompose.test.ts (char suite copy + retarget) | wired | n/a | 1 pass / 77 fail (Module not found "decompose.ts" — expected; resolves on S5) | n/a | char suite copied verbatim from v1; `import.meta.dir` auto-targets the v2 entrypoint. v1 suite still 78/78 green. |
| S1 | runbooks/issue-to-pr-v2/lib/contract.ts + contract.test.ts | green | 21 pass / 0 fail | unchanged (still 1/77 — entrypoint lands at S5) | n/a | Lifted v1 lines 99-181 verbatim into lib/contract.ts (16 const declarations + 2 type aliases, all exported). tsc clean, biome clean, v1 baseline still 78/78. |
| S2 | runbooks/issue-to-pr-v2/lib/digest.ts + digest.test.ts | green | 13 pass / 0 fail | unchanged (entrypoint lands at S5) | n/a | Lifted contractDigest and sha256Digest verbatim from v1 lines 834-858. Also promoted `Batch` interface into lib/contract.ts so digest.ts can be a leaf module. AC3 invariant verified by test: adding lifecycle fields to a Batch row produces an identical digest. Legacy-compat (omit null supersedes) preserved. |
| S3 | runbooks/issue-to-pr-v2/lib/ledger.ts + ledger.test.ts | green | 4 pass / 0 fail (module) + covered by char suite (integration) | n/a (combined with S5) | n/a | Merged S3+S4+S5 into one commit per agreed plan (deep interleaving between parsers and validators + shared fail() sink made splitting artificial). Lifted v1 lines 182-2106 verbatim into lib/ledger.ts. lib/ledger.test.ts added in follow-up commit pinning DecomposeError + parse public exports. |
| S4 | runbooks/issue-to-pr-v2/lib/validate.ts + validate.test.ts | green | 5 pass / 0 fail (module) + covered by char suite (integration) | n/a (combined with S5) | n/a | Thin re-export module exposing parse / validateLedgerBatches / validateFindingsData / validateAcCoverage / emitContractDigest from lib/ledger.ts. lib/validate.test.ts pins the re-export contract. |
| S5 | runbooks/issue-to-pr-v2/decompose.ts compatibility entrypoint | green | **78 pass / 0 fail** — byte-for-byte parity with v1 | n/a | Thin CLI dispatcher importing from lib/ledger.ts. tsc clean, biome strictly cleaner than v1 (dropped one unused-function warning by omitting v1's unused parseLedgerBatches), v1 baseline still 78/78. |
| R1 | /ce-code-review final pass (kieran-typescript-reviewer + correctness-reviewer + performance-reviewer + testing-reviewer) | done | n/a | n/a | 4 reviewers run in parallel — 1 P1 + 3 P2 + 1 P3 surfaced; 3 fixed, 1 closed not-in-u3-scope (see Findings sub-ledger). | All four reviewers run; convergence achieved per AC5 (partially) and AC6. |

## Status legend

- `pending` — slice not started
- `wip` — slice in progress; tests not yet green
- `green` — unit tests pass and v2 char suite still passes byte-for-byte
- `reviewed` — green AND covered by the R1 reviewer pass with zero open findings
- `done` — all upstream rows reviewed; unit complete
- `closed` — slice deferred to a later seam with a `not-in-u3-scope` resolution

## Findings sub-ledger (R1 reviewer pass)

| id | signature | severity | status | summary | resolution |
| --- | --- | --- | --- | --- | --- |
| F001 | v2-tree-excluded-from-tsconfig-include | P1 | fixed | tsconfig.json `include` was v1-only; v2 type errors invisible to repo-level tsc. | Added `runbooks/issue-to-pr-v2/**/*.ts` to the include array. Repo-wide tsc now type-checks the v2 tree (0 errors). |
| F002 | u3-newly-public-exports-missing-jsdoc | P2 | fixed | Newly-promoted v1-internal exports in lib/ledger.ts (parse, emit, emit*, validate*, readLedgerBatchContext, DecomposeError, fail) had no JSDoc. | Added one-paragraph JSDoc per dispatch-surface export: DecomposeError, fail, parse, emit, emitContractDigest, emitPlanDigest, emitAcDigest, emitConfirmationState, readLedgerBatchContext, validateLedgerBatches, emitLedgerBatchContractDigest, validateFindingsData, validateAcCoverage. Function bodies untouched. |
| F003 | u3-validate-test-rubber-stamps-reexports | P2 | fixed | validate.test.ts asserted `typeof === 'function'` only — a rebind like `export { emit as parse }` would silently pass. | Rewrote the 5 tests to assert reference identity against ./ledger (e.g. `expect(validate.parse).toBe(ledger.parse)`). Catches misbound re-exports at the unit level. |
| F004 | u3-validator-helpers-no-module-level-behavior-tests | P2 | closed | AC5 only partially satisfied: validators (validateLedgerBatches, validateFindingsData, validateAcCoverage, emitContractDigest) covered by char suite but not by module-level behavior tests. Blocker: fail() calls process.exit(1) and nonExiting() is module-private. | Closed `not-in-u3-scope`. The structural blocker is real: exposing a test-only fail-mode toggle is a contract change. U4 lands `cli.ts` with a structured-error mode (per plan R5/R6); that's the right place to add validator behavioral unit tests. Recorded as a forward dependency. The char suite at 78/78 is the authoritative behavior gate until then. |
| F005 | u3-ledger-parse-error-paths-untested-at-unit-level | P3 | closed | parse() ~20 fail() branches have no unit-level coverage; same fail()/exit structural blocker as F004. | Closed `not-in-u3-scope`. Same forward dependency on U4 cli.ts structured-error mode. Char suite covers every branch end-to-end. |
