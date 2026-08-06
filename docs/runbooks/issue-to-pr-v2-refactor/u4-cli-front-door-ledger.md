# U4 CLI front door - findings ledger

Format and protocol: see [README.md](README.md#ledger-format).

Sweep 1 — `/ce-code-review` with 4 parallel personas (correctness +
api-contract + kieran-typescript + testing + scope-guardian). 22 findings
surfaced across 4 personas (correctness reviewer returned no findings).

| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
| F001 | cli-error-envelope-exit-code-mismatch-with-process-exit | fixed | low | `error.exit_code` defaulted to 1 but usage paths returned 64; envelope and process disagreed. | Passed `exitCode: 64` explicitly to all five usage-error envelopes (missing-command, missing-json-flag, unknown-command, missing-required-arg, unknown-contract-slice) and `exitCode: 70` to unexpected-error. New test pins parity. |
| F002 | cli-state-digest-drift-asymmetric-missing-digests-axis | fixed | low | `digest_drift` returned `{acceptance_criteria, batch_contract, any}` but folded digests into `any` only. | Added `digests` axis to the `DigestDrift` shape. Hoisted `computeDigestDrift` into `lib/route.ts` as part of F020 with three module-level tests covering each axis. New cli.test.ts assertion pins the four-field shape. |
| F003 | cli-contract-slice-ordering-inconsistent-route-ids-vs-rest | fixed | low | Contract slices were sorted alphabetically except `route_ids` which used catalog order; no discriminator. | Added `ordering: "sorted" \| "catalog"` to every contract slice response. Catalog-ordered slices: `route_ids`, `agent_hint_actions`, `runtime_error_severities`, `runtime_error_recoverabilities`, `diagnostic_levels`, `exit_codes`. |
| F004 | cli-envelope-missing-schema-version-field | fixed | low | Both envelopes had no `schema_version`; future breaking changes invisible to old consumers. | Added `CLI_ENVELOPE_SCHEMA_VERSION = "1"` constant and `schema_version` field to both `CliSuccessEnvelope` and `CliErrorEnvelope`. New cli.test.ts assertion pins the value. |
| F005 | cli-help-missing-error-codes-and-exit-code-catalog | fixed | low | --help omitted error_codes, exit_codes, agent_hint_actions, severities, recoverabilities. | Expanded `HELP_DATA` with `error_codes`, `exit_codes`, `agent_hint_actions`, `runtime_error_severities`, `runtime_error_recoverabilities`, `diagnostic_levels`. Also added five new contract slices (`agent_hint_actions`, `runtime_error_severities`, `runtime_error_recoverabilities`, `diagnostic_levels`, `exit_codes`) so agents can query each enum independently. |
| F006 | cli-state-blocking-gates-shape-mixes-route-ids-and-key-value-strings | fixed | low | `blocking_gates` array mixed route-id strings and field:value strings without a discriminator. | Replaced with typed discriminated union: `{ kind: "route_id"; value: BlockedRouteId } \| { kind: "field"; field: string; value: string }`. Hoisted `blockingGatesFor` into `lib/route.ts` (part of F020). Five module tests cover both gate kinds; cli.test.ts updated. |
| F007 | cli-unexpected-error-envelope-missing-agent-hint | fixed | low | `unexpected-error` envelope had no hint while every other error path did. | Added `hint: { summary: "Unexpected internal error. Capture run_id and report to the runbook maintainer.", action: "contact_support" }`. Also added a stderr `level: error` diagnostic emission on the unexpected-error path. |
| F008 | cli-route-id-catalog-order-drift-between-code-and-prose | fixed | low | `BLOCKED_ROUTE_IDS` array order in lib/route.ts diverged from the prose precedence-order table in references/ledger-and-helper.md. | Reordered `BLOCKED_ROUTE_IDS` to match the precedence-order prose table and `classifyRoute` walk. Updated route.test.ts assertion. Both surfaces now use the same single ordering. |
| F009 | cli-diagnose-drift-findings-table-drift-untyped-placeholder | fixed | low | `findings_table_drift: null` had no documented future shape. | Declared `FindingsTableDrift = null` type alias and `DiagnoseDrift` interface in cli.ts. New `buildDiagnoseDrift` helper isolates the shape. Comment names U6/U9 as the future widening point and requires a `schema_version` bump. |
| F010 | route-id-switch-missing-exhaustiveness-guard | fixed | low | `requiredReferenceIdsFor` switch had no `default: const _: never = route` arm. | Added exhaustiveness guard. Test sweeps every `RouteId` to verify all branches return defined values; `shipped` returns `[]` (terminal), every other route returns a non-empty list. |
| F011 | diagnostic-attributes-can-shadow-structured-fields | fixed | low | `emitDiagnostic` spread attributes after structured fields, letting an attribute like `run_id: "fake"` shadow the canonical value. | Added `RESERVED_DIAGNOSTIC_KEYS` set + `stripReservedDiagnosticKeys` helper. Reserved keys are stripped before the spread so structured fields always win. New module test pins the behaviour by passing every reserved key in `attributes` and asserting none of them survive. |
| F012 | blocking-gates-inline-structural-type-duplicates-ledger-snapshot | fixed | low | `blockingGatesFor` inlined a structural subtype of `LedgerSnapshot`. | Hoisted into `lib/route.ts` with an explicit typed parameter; cli.ts passes a structurally-compatible object. Type is now declared in one place. |
| F013 | u4-cli-test-no-imperative-regex-too-narrow | fixed | low | ` run `/i required surrounding spaces; would miss `"route_id":"run-..."`. | Switched the forbidden-pattern array to `\b`-word-boundary regexes (`\brun\b`, `\bexecute\b`, etc.) which match verbs adjacent to JSON quotes too. |
| F014 | u4-cli-test-stale-digest-scenario-missing | fixed | low | "AC7 stale ledger scenarios" describe block tested frontmatter-blocked instead. | Added two new tests: one with `ac_confirmation_status: stale` → `blocked-acceptance-criteria-stale`, one with `batch_contract_confirmation_status: stale` → `blocked-batch-contract-stale`. |
| F015 | u4-cli-test-version-skew-default-not-asserted | fixed | low | `version_skew` assertions used `toBeDefined()`. | Both state and diagnose tests now assert `expect(data.version_skew).toBe("matched")`. |
| F016 | u4-cli-test-installed-artifact-presence-static-true-not-asserted | fixed | low | `installed_artifact_presence` only asserted `typeof === "boolean"`. | Tightened to `expect(presence.cli).toBe(true)` etc. for all four fields. Module test in route.test.ts also pins the static U4 baseline. |
| F017 | u4-cli-test-happy-path-stage-progression-not-exercised-end-to-end | partial | low | `minimalConfirmedLedger` produces `pick-issue` because no `ac_digest` is written; real happy-path routes need digest write infrastructure. | Added a partial-coverage test documenting the pick-issue fallback when `ac_confirmation_status: confirmed` is declared without a matching stored digest. Closed `not-in-u4-scope`. Full happy-path stage progression (`plan`, `decompose`, `batch-loop`, `final-review`, `ship`, `shipped`) needs digest write helpers that belong with U6's ledger frontmatter work; the U6 seam ledger captures this as a forward dependency. |
| F018 | u4-cli-test-quiet-mode-suppression-vacuous | fixed | low | `--quiet` test claimed "even on error envelopes" but exercised a happy path. | Rewrote the test to use a malformed-ledger fixture that triggers a `level: error` diagnostic in default mode. `--quiet` mode now actually proves suppression of a stderr-bound event. |
| F019 | u4-cli-test-unexpected-error-branch-untested | partial | low | `emitErrorFromException`'s generic Error branch (exit 70, severity fatal) has no test. | Closed `not-in-u4-scope`. Triggering a non-`DecomposeError` exception in-process requires mocking the lib/* surface; deferred to U7+ when the hot router has a host-mocked test harness. The branch is correctness-reviewed and the `hint: { action: "contact_support" }` addition (F007) covers the schema for it. |
| F020 | logic-in-cli-ts-belongs-in-lib | fixed | low | `computeDigestDrift`, `requiredReferenceIdsFor`, `blockingGatesFor`, `installedArtifactPresence` were private to cli.ts; R6 says they belong in lib/*. | Hoisted all four into `lib/route.ts`. cli.ts now imports them. Each gets dedicated module-level tests in route.test.ts. cli.ts is now genuinely a thin dispatcher. |
| F021 | blocked-route-id-array-order-mismatches-prose-table | fixed | low | Duplicate of F008 from a different reviewer; same fix applies. | Closed as `duplicate-of-F008`. Marking fixed because the F008 reordering resolves both. |
| F022 | ac7-version-skew-and-stale-digest-routes-untested | fixed | low | Stale-digest and most happy-path routes had no CLI fixture. | Stale-digest paths covered by F014's two new tests. Happy-path stage progression beyond `pick-issue` deferred per F017 partial. Version-skew correctly deferred to U6 (the field itself lands there). |

Sweep 2 — second `/ce-code-review` pass with the same 4 reviewer personas
after applying sweep-1 fixes. 16 net-new findings surfaced as downstream
effects of the new contract surface (HELP_DATA expansion, schema_version,
typed BlockingGate, F011 strip helper, F003 ordering discriminator).
347/347 tests passing after sweep-2 fixes. tsc clean. biome clean.

| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
| F023 | help-error-codes-hint-action-flat-but-envelope-hint-is-nested | fixed | low | (P1) HELP_DATA.error_codes used flat `hint_action: "..."` but runtime envelope nests as `error.hint.action`. Agents would encode the wrong access path. | Restructured ERROR_CODES entries to use nested `hint: { action: AgentHintAction }` matching the envelope shape verbatim. Added integration test that pulls a known error code from --help and verifies every field (code, hint.action, severity, recoverability, retryable, exit_code) matches the runtime envelope for the same code. |
| F024 | exit-codes-slice-strips-meaning-but-help-data-keeps-it | fixed | low | (P2) `exit_codes` contract slice emitted bare numbers; HELP_DATA.exit_codes kept full {code, meaning} objects. | Loosened `ContractSliceValue.values` to accept `string \| number \| object` items. Updated CONTRACT_SLICE_VALUES.exit_codes to emit `{ code, meaning }` records symmetric with HELP_DATA. New test pins the shape. |
| F025 | contract-slice-ordering-discriminator-undocumented-in-help-payload | fixed | low | (P2) F003 added `ordering` field but HELP_DATA didn't document it. | Added `contract_slice_response_shape` to HELP_DATA with documented `sorted` / `catalog` semantics. New test asserts the field is present with the documented values. |
| F026 | help-error-codes-missing-severity-and-retryable-fields | fixed | low | (P2) ERROR_CODES omitted `severity` and `retryable` even though the runtime envelope always emits them. | Added both fields to every ERROR_CODES entry. Integration test (see F023) verifies parity between help-catalog severity/retryable and runtime envelope severity/retryable. |
| F027 | u4-cli-test-f003-ordering-discriminator-untested-on-contract-envelope | fixed | low | (P2) No test asserted the new `ordering` discriminator on any contract slice envelope. | Added two assertions: sorted slices (execution_modes) report `ordering: "sorted"`; catalog slices (route_ids) report `ordering: "catalog"`. |
| F028 | u4-cli-test-f005-help-payload-additions-untested | fixed | low | (P2) F005's six new HELP_DATA fields had no test. | Added `--help exposes the full error and exit-code discovery surface` test asserting every new field is present. |
| F029 | u4-cli-test-f005-new-contract-slices-untested | fixed | low | (P2) Five new contract slices (agent_hint_actions, runtime_error_severities, runtime_error_recoverabilities, diagnostic_levels, exit_codes) had no contract-command test. | Added five new tests, one per slice, exercising the CLI dispatch and asserting representative members. |
| F030 | u4-cli-test-f004-error-envelope-schema-version-untested | fixed | low | (P2) `schema_version` was asserted only on the success envelope path. | Added `F004 fix: error envelope also carries schema_version: '1'` test covering the missing-json-flag error path. |
| F031 | u4-route-test-blocking-gates-ac-confirmation-status-branch-untested | fixed | low | (P2) blockingGatesFor's `acceptance_criteria: "blocked"` field-gate branch had no test. | Added test asserting the `{kind: "field", field: "ac_confirmation_status", value: "blocked"}` gate is emitted. |
| F032 | u4-diagnostics-test-f011-reserved-key-strip-only-event-meaningfully-verified | fixed | low | (P2) F011 attribute-shadowing test only meaningfully verified `event` because of the spread order. | Reversed the spread order in `emitDiagnostic` so structured fields come first and `stripReservedDiagnosticKeys` is genuinely load-bearing for every reserved key. Strengthened the F011 test to also assert `duration_ms` shadowing fails. |
| F033 | u4-cli-test-f018-quiet-suppression-lacks-positive-control | fixed | low | (P2) F018 test asserted stderr empty under --quiet but had no positive control proving the same scenario emits without --quiet. | Added a sibling test asserting the malformed-ledger fixture in default mode produces at least one `level: error` JSON Lines record on stderr. The pair (default-emits, quiet-suppresses) now proves suppression. |
| F034 | u4-route-test-required-reference-ids-value-mapping-partially-pinned | fixed | low | (P3) Eight RouteIds had only non-empty-array assertions, not value-level pins. | Added a `Record<RouteId, readonly string[]>` snapshot with explicit expected values for all 14 routes, iterated via a parameterised test. |
| F035 | command-context-diagnostic-options-duplicates-cli-diagnostic-options | fixed | low | (P3) CommandContext inlined a structural duplicate of CliDiagnosticOptions. | Imported CliDiagnosticOptions from lib/cli-diagnostics and replaced the inline shape with a single type reference. |
| F036 | error-codes-literal-not-constrained-to-agent-hint-action-recoverability-enums | fixed | low | (P3) ERROR_CODES catalog escaped the canonical AgentHintAction / RuntimeErrorRecoverability / RuntimeErrorSeverity enums. | Added `ErrorCodeEntry` type annotation and `satisfies readonly ErrorCodeEntry[]` on ERROR_CODES so a future rename of an enum value forces a compile error here. |
| F037 | cli-ts-type-leakage-findingstable-drift-and-diagnose-drift | fixed | low | (P2) FindingsTableDrift and DiagnoseDrift types lived in cli.ts despite being contract-surface shapes. | Hoisted both types + the `buildDiagnoseDrift` helper into `lib/route.ts`. cli.ts now imports them. |
| F038 | cli-diagnose-drift-comment-overstates-u4-scope | closed | low | (P3 advisory) FindingsTableDrift comment in cli.ts pre-designed the U6 API from inside U4. | Closed alongside F037 — the hoisted version in lib/route.ts uses a one-line forward-compat note instead of the multi-paragraph design sketch. |

Sweep 3 — third `/ce-code-review` pass with api-contract + testing reviewers
(other personas held given the converging signal). api-contract returned
**no findings**. Testing surfaced 2 net-new findings both rooted in F037's
hoist not getting paired test coverage; both fixed below. 351/351 tests
passing after sweep-3 fixes.

| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
| F039 | u4-cli-test-f037-build-diagnose-drift-no-unit-test | fixed | low | (P2) F037 hoisted `buildDiagnoseDrift` to lib/route.ts but skipped the dedicated module test required by the F020 hoist pattern. | Added `describe("buildDiagnoseDrift")` block with three tests: all-confirmed snapshot → no drift; stale-axis snapshot → correct axis flag + `any: true`; `findings_table_drift` forward-compat pin (always null in U4). |
| F040 | u4-cli-test-ac4-diagnose-drift-shape-vacuous | fixed | low | (P2) AC4 diagnose envelope asserted `data.drift` only as `toBeDefined()` — F037's DiagnoseDrift contract surface unverified. | Added an explicit four-axis shape pin (acceptance_criteria, batch_contract, digests, any all boolean) and a `findings_table_drift === null` forward-compat assertion. Mirrors the F002 fix pattern applied to state envelope. |

## Convergence — sweep 4

Final pass with all four reviewer personas (api-contract + testing +
kieran-typescript + scope-guardian) in parallel after the sweep-3 fixes.
**All four returned no findings.** Convergence achieved.

Final state:
- **351 / 351 tests passing** across 10 files (v1 char 78 + v2 char 78 +
  6 lib unit modules + cli.test.ts + lib/ledger.test.ts validator
  behaviors).
- **tsc clean** repo-wide with v2 included in the include path (per
  U3 F001 fix).
- **biome clean** with 0 errors, 2 warnings (both inherited verbatim from
  v1 helper, intentional behaviour preservation).
- **40 findings** surfaced across 3 review sweeps. 38 fixed in code, 2
  closed `not-in-u4-scope` with documented forward dependencies on U6
  (digest write helpers) and U7+ (host-mocked test harness for the
  unexpected-error branch). Full audit trail in this ledger.

Issue #52 AC mapping:
- AC1 (machine-consumed --json) — fixed (F001) + tested
- AC2 (state facts) — fixed (F002 digest_drift, F005 expanded surface) + tested
- AC3 (next minimal, no imperatives) — preserved + F013-strengthened regex
- AC4 (diagnose facts) — fixed (F040 shape pin) + tested
- AC5 (runtime contract slices) — fixed (F005 expanded catalog) + tested
- AC6 (deterministic route ids) — preserved + tested
- AC7 (happy / no-ledger / stale / version-skew / missing / no-imperative) — fixed (F014 stale; F018 quiet positive control); happy-path stage progression partial pending U6 digest helpers; version-skew correctly deferred to U6; unexpected-error branch deferred to U7+ harness.

Per the seam's stop condition (zero new findings, all ledger rows fixed
or closed), U4 has converged.
