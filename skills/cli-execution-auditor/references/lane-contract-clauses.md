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

## Floor-clause provenance

Agent-native floor clauses (stderr discipline, run correlation, structured
failure category, retry safety) come from
`skills/create-cli/references/agent-native-cli-design.md` "Runtime-Contract
Minimum" — cited by reference, never copied.
