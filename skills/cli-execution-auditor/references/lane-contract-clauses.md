# Lane contract clauses — human map

Maps each v1 facade-lane clause to the code-owned source it cites. No contracts
are copied here; the catalog (`src/clause-catalog.ts`) is the machine-readable
authority and `runtime/cli-command-facade/AGENTS.md` owns the lane contract.

Format-compatible with `skill-self-audit-loop`'s documented findings-table
template (Open Findings / Finding History, `status:`, `signature`). The auditor
owns an auditor-local ledger writer (`src/ledger/`); a shared module is extracted
only when a second code consumer exists.

## Static clauses (caught with zero target invocations)

- **exit-floor** → `COMMAND_FACADE_BASELINE_EXIT_CODES` (`runtime/cli-command-facade/src/command-contract.ts`); detected via `parseCommandFacadeContract` emitting `command-baseline-exit-*-missing`. The 0/1/2 floor is machine-enforced; supersedes older create-cli prose.
- **help-flag-alignment** → `assertCommandHelpFlagSurface` (`runtime/cli-command-facade/src/testing.ts`). Rendered help must advertise exactly the contract's flags.
- **redaction-discipline** → `assertNoRuntimeContractFixtureLeaks` + `RUNTIME_CONTRACT_REDACTION_FIXTURES` (`runtime/cli-command-facade/src/testing.ts`). No projected text leaks a known secret marker.
- **no-raw-runner** → source-grep rule `no-raw-test-runner`. Source routes runners via `test-runner.sh` / MCP runners, never raw `bun test` / `biome` / `tsc` (code-quality rule). heal bug a.
- **vacuous-match** → source-grep rule `no-vacuous-pass-on-empty-set`. A path-resolving check must not report `ok` on an empty referenced set. heal bug b.

## Surface clauses (caught only by an invocation)

- **json-valid-under-failure** → `createCliRuntimeErrorEnvelope` (`runtime/cli-command-facade/src/runtime-envelope.ts`). `--json` on a failure path emits a valid structured envelope.
- **declared-coverage-runs** → source-grep rule `coverage-exercises-all-declared`. A check that declares N targets exercises all N. heal bug c.

## Masking-resistance (R7)

Masking-resistance is a property of clause strength, not re-check provenance.
Each clause's `maskingNote` in the catalog states whether it is resistant (no
cheaper-to-satisfy form than the real fix) or names the known cheaper-satisfying
form (a recorded v1 limit). `no-raw-runner`, `vacuous-match`, and
`declared-coverage-runs` carry documented limits; the rest are resistant.

## Clause dependencies (co-fire map)

Clauses are not fully independent: a single defect can trip more than one clause
when they read the same input surface. The fixture corpus asserts each bad
fixture fires AT LEAST its target clause plus a documented co-fire set — never
"exactly one" — so a legitimate cascade is an expected co-fire, not a noisy
regression.

- **redaction-discipline** and **help-flag-alignment** both read projected
  contract text (summaries, flag descriptions, usage). A defect in that text can
  trip both.
- **json-valid-under-failure** and **exit-code-matches-declared** both read a
  failing invocation's output; a broken failure path can trip both.

In v1 every fixture is a complete runnable forked from `good-baseline` with one
injected defect, so the observed co-fire sets are empty. The corpus structure
keeps the co-fire column so a future cascading defect stays documented.

## Floor-clause provenance

Agent-native floor clauses (stderr discipline, run correlation, structured
failure category, retry safety) come from
`skills/create-cli/references/agent-native-cli-design.md` "Runtime-Contract
Minimum" — cited by reference, never copied.
