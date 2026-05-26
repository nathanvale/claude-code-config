# Runbook: V2 CLI smoke matrix (U10)

**Seam:** Exhaustive contract pinning for the v2 CLI surface via
process-boundary smoke tests. U4-U6 shipped 420 unit tests for `cli.ts`
internals; U7 shipped the hot router that consumes them; U9 wired the
regression matrix to those tests. None of this exercises the
**installed-path → invoke → envelope round-trip** at the process
boundary across every command × every documented contract.

U10 closes that gap. It adds a single new test file at
`runbooks/issue-to-pr-v2/cli-smoke.test.ts` that spawns `cli.ts` as a
child process and asserts the documented envelope contract holds for:

- Every command (`state`, `next`, `contract`, `diagnose`, `packet`) across the
  documented ledger states (`no-ledger`, valid, `blocked-frontmatter`,
  `blocked-runbook-version-skew`, stale-digests).
- Every `contract_slices` entry (16 slices documented in `HELP_DATA`).
- Every `packet_roles` entry (5 roles) with its required-flag matrix.
- Every documented `error_code` (10 codes in `HELP_DATA.error_codes`),
  except `unexpected-error` which may be unprovokable in smoke and is
  flagged as residual.
- The cross-cutting envelope invariants (exactly one envelope on stdout,
  diagnostics on stderr separated, `schema_version`/`status`/`run_id`/
  `started_at_ms`/`duration_ms` always present, `next` never imperative).

**Central risk: pinning a moving contract.** The v2 CLI's documented
`HELP_DATA` is the source of truth for every envelope field, error code,
exit code, packet role, and contract slice. If U10 pins behaviour the
CLI source itself diverges from, the smoke runbook silently rots. To
mitigate, U10's tests assert against `HELP_DATA` reads at test time
where possible (read once per file, reuse across cases) rather than
hardcoding string literals — drift between the runtime catalog and the
documented catalog should fail noisily, not silently.

**Ledger:** [u10-cli-smoke-matrix-ledger.md](u10-cli-smoke-matrix-ledger.md)

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Pre-existing test surface (read-only context)

U10 complements, does not replace, the existing test surface:

| Test surface | What it covers | U10 boundary |
| --- | --- | --- |
| `runbooks/issue-to-pr-v2/cli.test.ts` (~80+ describes / 200+ tests) | Unit-level envelope shape, AC1-AC7 contracts, U6 version-skew, U5 packet rendering | U10 does NOT duplicate these; smoke spawns the CLI as a child process |
| `runbooks/issue-to-pr-v2/lib/*.test.ts` | lib internals — route classification, packet rendering, ledger parsing, digest, validate | U10 does NOT touch lib internals |
| `runbooks/issue-to-pr-v2/decompose.test.ts` | Legacy-compat helper surface (process-boundary) | U10 covers `cli.ts`; `decompose.ts` is the legacy-compat layer |

U10 sits *between* unit tests and the operator. Where `cli.test.ts`
imports CLI functions, U10 spawns `bun cli.ts` as a child process and
parses stdout. This is the seam that exercises the install-path
symlink, the actual argument parsing, the real stdout/stderr split, and
the process exit behaviour.

## Files in scope

**Writable (this seam's contract surface):**

- `runbooks/issue-to-pr-v2/cli-smoke.test.ts` (new; the smoke matrix.
  Expected size: 600-1000 lines for exhaustive coverage. Uses Bun test
  with `Bun.spawn` or equivalent to invoke `bun cli.ts ...` as a child
  process. Asserts envelope shape, exit code (where applicable),
  stdout/stderr separation, and command-specific data fields.)
- `runbooks/issue-to-pr-v2/references/regression-matrix.md` (modify:
  add exactly ONE new row `probe-cli-smoke-matrix` to the
  `Deterministic probe targets` table, citing the new test file +
  every top-level `describe()` block by name. No other matrix changes.)
- `docs/runbooks/issue-to-pr-v2-refactor/README.md` (modify: add U10
  row to the contract-shaped seams table and a matching `/goal`
  invocation block; update suggested execution order to include U10
  as the post-U9 follow-on)

**Read-only (frozen):**

- `runbooks/issue-to-pr-v2/cli.ts` — the CLI source under test. If U10
  surfaces a real CLI bug, file as a separate issue. Do NOT modify
  `cli.ts` from inside U10.
- All `runbooks/issue-to-pr-v2/lib/*.ts` source. Same rule — if smoke
  surfaces a lib bug, file separately.
- `runbooks/issue-to-pr-v2/cli.test.ts` — existing unit tests. U10
  does not augment or replace these.
- `runbooks/issue-to-pr-v2/decompose.ts` and `decompose.test.ts`.
- `runbooks/issue-to-pr-v2/issue-to-pr.md` (U7 hot router).
- `runbooks/issue-to-pr-v2/README.md` (U8/U9 README).
- All `runbooks/issue-to-pr-v2/references/*.md` except
  `regression-matrix.md`.
- All `runbooks/issue-to-pr-v2/templates/*.md`.
- `tsconfig.json` (already includes v2 tree from U3/U4).
- `install.sh` (already surfaces v2 install presence per U6).
- Deleted legacy tree (`runbooks/issue-to-pr/`) — do not restore.

**Read-only (anchors — this seam consumes them):**

- `runbooks/issue-to-pr-v2/cli.ts` `HELP_DATA` constant (defines the
  contract surface U10 pins)
- `runbooks/issue-to-pr-v2/lib/contract.ts` — `RUNBOOK_VERSION`,
  `ROUTE_IDS`, `EXECUTION_MODES`, etc., referenced by some smoke
  assertions
- `docs/plans/2026-05-22-002-refactor-issue-to-pr-v2-runbook-plan.md`
  (R12, R13 — hybrid regression coverage requirement)

## What U10 is NOT — explicit anti-list

- **No new CLI commands, no new envelope fields, no new packet roles,
  no new error codes.** U10 pins the existing contract; it does not
  expand it.
- **No edits to `cli.ts` source.** If a smoke test surfaces a real
  bug, file a separate issue with risk `high` and ask before touching
  the CLI. (The U9 manual-smoke "process exit vs envelope" suspicion
  turned out to be a false alarm; see Block 10 and ledger finding
  `false-alarm-process-exit-divergence`.)
- **No edits to `lib/*.ts` source.** Same rule.
- **No edits to existing `*.test.ts` files.** U10 adds one new test
  file, does not modify the existing 420-test surface.
- **No `tsconfig.json`, `install.sh`, or hot-router edits.**
- **No regression-matrix structural changes** beyond adding the
  single `probe-cli-smoke-matrix` row. No new sections, no schema
  changes, no edits to existing rows.
- **No README-level edits beyond the refactor-area README seam-row
  addition.** v2 README stays frozen; do not restore the deleted
  legacy README.
- **No process-exit-vs-envelope alignment work.** Writing the smoke
  block disproved the suspected divergence — process exit codes
  already match envelope `exit_code` today. Block 10 pins the
  alignment as a regression surface.

## Matrix structure (MUST include)

The new test file MUST contain top-level `describe()` blocks for each
of the following categories. Each block's name appears verbatim in the
regression-matrix row's `test_anchor` so a reviewer can grep from
contract to test in one hop.

### Block 1: Envelope-shape invariants (cross-command)

For every command except errors, the envelope MUST carry:

- `status: "ok"` (success) or `status: "error"` (error)
- `schema_version: "1"` (string, equals `HELP_DATA.schema_version`)
- `run_id` (UUIDv4-shaped string)
- `started_at_ms` (positive number)
- `duration_ms` (non-negative number)
- On success: `data` (object); on error: `error` (object with the
  documented `error_code` fields)

### Block 2: Every command × `--json` requirement

Every machine-consumed command requires `--json`. Smoke MUST verify:

- `state <ledger>` (no `--json`) → `error.code: "missing-json-flag"`,
  envelope `exit_code: 64`
- Same for `next`, `contract`, `diagnose`, `packet`

### Block 3: `state` command × ledger states

For each ledger state, assert the returned `data.route_id` and
`data.confirmation_state`:

- no-ledger (path does not exist) → `route_id: "no-ledger"`,
  `ledger_exists: false`
- valid pending ledger (frontmatter present, AC unconfirmed) →
  `route_id: "pick-issue"`
- valid confirmed-and-batch-confirmed ledger → `route_id` matches the
  current stage
- ledger with `status: blocked` in frontmatter →
  `route_id: "blocked-frontmatter-blocked-reason"`
- ledger with `runbook_version: "1"` (mismatched) →
  `route_id: "blocked-runbook-version-skew"` + stop-required
  field gate

### Block 4: `next` command × no-imperative contract

Every `next` invocation MUST return ONLY `route_id` and `ledger_exists`
in `data`. The stdout payload MUST NOT contain any imperative verbs
(`run`, `execute`, `dispatch`, `ask`, `tell`, `invoke`, `call`, `do`)
as standalone words. This pins ADR 0002 at the process boundary.

### Block 5: `contract` command × every documented slice

For every entry in `HELP_DATA.contract_slices` (read at test time, not
hardcoded), assert:

- `contract <slice> --json` succeeds with `data.slice` equal to the
  requested slice name and `data.values` non-empty
- `contract unknown-slice-xyz --json` → `error.code: "unknown-contract-slice"`,
  `exit_code: 64`

### Block 6: `diagnose` command × ledger states

Mirror Block 3's state matrix but verify the richer diagnose envelope:

- `data.installed_artifact_presence.all_present: true` for the
  in-repo install (the install-symlink topology is correct in this
  repo as a U6 invariant)
- `data.drift.digest_drift` carries the documented three-axis
  + `any` shape
- `data.drift.findings_table_drift: null` (forward-compat slot per
  F037 hoist)
- `data.runbook_version_skew` matches the ledger's
  `runbook_version` against `lib/contract.ts` `RUNBOOK_VERSION`

### Block 7: `packet` command × every role × required-flag matrix

For each role in `HELP_DATA.packet_roles`:

- Happy path: all required flags present → success envelope
- Missing each required flag (one at a time) →
  `error.code: "missing-packet-flag"`, `exit_code: 64`
- Unknown role → `error.code: "unknown-packet-role"`, `exit_code: 64`

Required flags per role (read from `HELP_DATA.packet_role_flags`,
not hardcoded):

- `builder`: `--ledger`, `--batch`, `--attempt-type`
- `proposer`: `--ledger`, `--finding`
- `validator`: `--ledger`, `--batch`, `--persona`, `--commit`
- `patch-proposal`: `--ledger`, `--finding`, `--patch-id`,
  `--patch-name`, `--patch-goal`, `--patch-execution-mode`,
  `--patch-rationale`
- `ce-plan`: no required flags

### Block 8: Every documented `error_code`

For every entry in `HELP_DATA.error_codes` (read at test time), the
smoke MUST trigger that error at least once and verify the returned
envelope's `error.code` matches. The mapping:

| error_code | Trigger |
| --- | --- |
| `missing-command` | `cli.ts` with no args |
| `missing-json-flag` | Any command without `--json` |
| `missing-required-arg` | `state` without a ledger path |
| `unknown-command` | `cli.ts unknown-cmd --json` |
| `unknown-contract-slice` | `contract unknown-slice --json` |
| `unknown-packet-role` | `packet unknown-role --ledger x --json` |
| `missing-packet-flag` | `packet builder --ledger x --json` (missing `--batch` and `--attempt-type`) |
| `packet-render-failed` | `packet builder` against a ledger whose batch lookup fails |
| `ledger-validation-failed` | `state` against a ledger with broken YAML |
| `unexpected-error` | **Likely unprovokable from smoke** — flag as residual; document the unreachable-from-process-boundary status |

### Block 9: Stdout/stderr separation

For every invocation in Blocks 1-8 with diagnostics enabled (`--verbose`
or `--debug`), MUST verify:

- Exactly one JSON envelope on stdout, newline-terminated
- Zero-or-more JSON Lines diagnostic records on stderr
- The stdout payload contains no diagnostic content
- The stderr payload contains no envelope content

### Block 10: Process exit code alignment

Pins that process exit codes today match the envelope's documented
`exit_code` values for both success (0) and every error class (64
for usage errors, 1 for validation errors, 1 for packet-render-failed,
70 for unexpected errors). The seam runbook initially named this as a
suspected divergence based on a U9 manual-smoke `exit=$?` reading that
turned out to be a shell artifact (a piped `head -3` ate the real
exit code). Writing this block disproved the premise — see ledger
finding `false-alarm-process-exit-divergence` for the audit trail.

If the alignment drifts in a future change (intentional or not), this
block surfaces it loudly so the alignment work can update process
exit, the envelope `exit_code` docs, and these assertions together.

## Implementation patterns (MUST follow)

- **Read `HELP_DATA` once per test file** (e.g. by spawning `cli.ts
  --help --json` once and reusing the parsed result). Hardcoded
  string literals for commands, roles, slices, and error codes are
  brittle — read them from the CLI's own catalog at test time so the
  smoke fails when the catalog drifts.
- **Fixtures inline in the test file** for the simple cases (no
  separate fixture directory). For ledger fixtures with non-trivial
  YAML, use string templates with substitution.
- **Use `Bun.spawn`** (or `Bun.$` for shell convenience) to invoke
  the CLI as a child process. Capture stdout, stderr, and exit code
  separately.
- **Parse stdout as JSON exactly once per invocation.** Failed
  parses MUST surface as test failures with the raw stdout in the
  error message, not as silent JSON-parse exceptions.
- **Tests are deterministic.** No network calls, no real git
  operations on the repo, no wall-clock dependencies, no
  process-ID-dependent assertions. The `run_id` UUID is verified by
  shape (regex), not by value.

## Suggested reviewer personas

Always-on:

- `compound-engineering:ce-correctness-reviewer` — every cited
  `HELP_DATA` field, `error_code`, `packet_role`, and `contract_slice`
  actually exists; every assertion holds against the current
  `cli.ts`; the matrix row's `test_anchor` cites real `describe()`
  block names verbatim.
- `compound-engineering:ce-testing-reviewer` — each block in the
  smoke covers the contract it claims to cover; assertions are
  behaviour-level (envelope shape) not implementation-level (no
  reaching into lib internals from smoke); cross-block coverage is
  exhaustive but not duplicative.
- `compound-engineering:ce-api-contract-reviewer` — the smoke pins
  the documented contract verbatim; no drift between cited fields
  and `HELP_DATA`; no inadvertent expansion of the contract surface
  (e.g. asserting fields that don't exist yet).
- `compound-engineering:ce-scope-guardian-reviewer` — diff respects
  the anti-list (no `cli.ts` edits, no `lib/*.ts` edits, no existing
  `*.test.ts` edits, no README restructure, no process-exit
  alignment work).
- `compound-engineering:ce-maintainability-reviewer` — file
  structure is scannable; helper functions extracted where they
  reduce duplication; HELP_DATA read once and reused rather than
  re-spawned per test.

Conditional:

- `compound-engineering:ce-reliability-reviewer` — added because
  process spawning, stdout/stderr capture, and exit-code handling
  are reliability-sensitive surfaces.

## ADR guardrails

- **ADR 0001 (Orchestration / mechanic split).** Smoke tests
  mechanics — no orchestration claims.
- **ADR 0002 (CLI emits facts, not orchestration).** Block 4 pins
  this at the process boundary via no-imperative regex sweep.
- **R10 (preserve U3-U9 split).** No lib source changes; no edits
  to existing test files; one new test file only.
- **R12 (hybrid regression coverage).** U10 is the automated
  process-boundary half of R12's "hybrid coverage" requirement.
  The manual half is the prose-only invariant rows in the
  regression matrix (U1 + U9 audit anchor).

## Scoped audit prompt

````text
Review U10 CLI smoke matrix. The new test file at
`runbooks/issue-to-pr-v2/cli-smoke.test.ts` adds exhaustive
process-boundary smoke tests for every command in `cli.ts` against
every documented contract in `HELP_DATA`. The regression matrix
gains ONE new row (`probe-cli-smoke-matrix`) citing the test file
+ every top-level `describe()` block by name verbatim.

Audit items:

1. Does the smoke file contain `describe()` blocks for all 10
   documented categories (Blocks 1-10 in the U10 runbook)?
2. Does every cited contract field (`HELP_DATA` keys,
   `contract_slices`, `packet_roles`, `error_codes`) exist verbatim
   in `cli.ts` HELP_DATA today?
3. Does the smoke read HELP_DATA at test time (single spawn,
   reused across blocks) rather than hardcoding string literals?
4. Does Block 8 trigger every documented `error_code` except
   `unexpected-error`, and is `unexpected-error` documented as
   unreachable-from-smoke with a residual-risk comment?
5. Does Block 4 (`next` no-imperative) use a word-boundary regex
   matching the implementation in `cli.test.ts` AC3 to avoid
   false positives?
6. Does Block 10 pin the process-exit-vs-envelope divergence as
   current behaviour with a top-of-file comment citing the
   separate-issue tracker, rather than attempting to fix it?
7. Does the regression matrix `test_anchor` value name every
   top-level `describe()` block verbatim?
8. Does the diff respect the anti-list (no `cli.ts` edits, no
   `lib/*.ts` edits, no existing `*.test.ts` edits, no README
   restructure, no process-exit alignment work)?

Severity:
- P0: smoke contains an assertion that contradicts current `cli.ts`
  behaviour (false-failure risk); smoke modifies `cli.ts` or
  `lib/*.ts` source; smoke modifies an existing `*.test.ts` file;
  matrix `test_anchor` cites a `describe()` block that does not
  exist verbatim.
- P1: a documented `error_code` is not exercised; a `packet_role`
  required-flag combination is not exercised; smoke hardcodes a
  string literal that should be read from `HELP_DATA`.
- P2: assertion uses implementation-detail field instead of
  documented contract field; envelope-shape coverage is partial.
- P3: minor formatting; `describe()` block ordering drift from
  the runbook spec.

Return findings with stable kebab-case signatures (e.g.
`smoke-asserts-contradicting-current-cli-behaviour`,
`smoke-hardcodes-help-data-string-literal`,
`matrix-test-anchor-describe-block-missing`).

Do NOT propose edits to `cli.ts` or `lib/*.ts` source. Do NOT
propose process-exit-vs-envelope alignment changes — that is a
separate issue per the U10 design decision. Do NOT propose edits
to existing `*.test.ts` files.
````

## Closing a finding without fixing it

Seam-specific close reasons:

- `not-in-u10-scope` — finding belongs to a different unit or
  follow-on (e.g. a real CLI bug surfaced by smoke; a request to
  expand the contract surface).
- `deferred-to-cli-design-issue` — finding requests
  process-exit-vs-envelope alignment, which is a separate agentic-CLI
  design discussion.
- `unreachable-from-smoke-by-design` — finding requests coverage of
  an `error_code` or scenario that cannot be triggered from the
  process boundary (e.g. `unexpected-error`); U10 documents the gap
  as residual.

## Stop condition

Stop when ALL of the following hold:

1. `bun_runTests` is green across `runbooks/issue-to-pr-v2/`
   including the new `cli-smoke.test.ts`. The total test count
   grows by the number of `test()` blocks added; zero failures.
2. `tsc_check` is green across both v1 and v2 trees.
3. `biome_lintCheck` is green across the diff.
4. The regression matrix `Deterministic probe targets` table has
   the new `probe-cli-smoke-matrix` row with a `test_anchor`
   naming every top-level `describe()` block verbatim.
5. Two consecutive independent `/ce-code-review` passes each return zero new findings (see the README Convergence protocol).
6. Every ledger row is `fixed` or `closed`.
7. The smoke file's top-of-file comment documents the
   process-exit-vs-envelope alignment status (false alarm closed)
   and the ledger records `false-alarm-process-exit-divergence` as
   the audit trail.

## /loop fallback

```text
/loop 5 Follow docs/runbooks/issue-to-pr-v2-refactor/u10-cli-smoke-matrix.md.
Re-read the runbook and u10-cli-smoke-matrix-ledger.md at the start of every
turn. Echo the full ledger status table inline at the end of every turn.
```

Convergence is the README's [Convergence
protocol](README.md#convergence-protocol): two consecutive independent
clean passes from different angles, not zero-open after one pass. A
pass that files or fixes a finding resets the counter.
