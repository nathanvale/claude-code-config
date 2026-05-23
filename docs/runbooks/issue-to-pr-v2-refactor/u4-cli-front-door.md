# Runbook: V2 CLI front door (U4)

**Seam:** A new deterministic CLI under `runbooks/issue-to-pr-v2/cli.ts`
that emits four JSON-only commands (`state`, `next`, `contract`, `diagnose`)
plus a tiny supporting module tree. The CLI is a **fact emitter**, not an
orchestrator — it surfaces durable ledger state for the future hot router
to consume, never imperative instructions. The loop converges to zero new
findings across multiple sweeps and a green char + module test suite.

**Ledger:** [u4-cli-front-door-ledger.md](u4-cli-front-door-ledger.md)

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Files in scope

**Writable (this seam's contract surface):**

- `runbooks/issue-to-pr-v2/cli.ts`
- `runbooks/issue-to-pr-v2/cli.test.ts`
- `runbooks/issue-to-pr-v2/lib/cli-envelope.ts`
- `runbooks/issue-to-pr-v2/lib/cli-envelope.test.ts`
- `runbooks/issue-to-pr-v2/lib/cli-diagnostics.ts`
- `runbooks/issue-to-pr-v2/lib/cli-diagnostics.test.ts`
- `runbooks/issue-to-pr-v2/lib/route.ts`
- `runbooks/issue-to-pr-v2/lib/route.test.ts`
- `runbooks/issue-to-pr-v2/lib/ledger.ts` (targeted: export `setFailMode` /
  `withFailMode` so the CLI can run validators in throw mode and convert
  v1 `fail()` into structured `CliErrorEnvelope` instead of `process.exit`)
- `runbooks/issue-to-pr-v2/lib/ledger.test.ts` (closes U3 F004 — validator
  behavioral unit tests now unblocked)
- `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` (route id
  catalog as prose, linking back to `lib/route.ts` as executable source
  of truth)

**Read-only (U3 surface — frozen except for the fail-mode edits above):**

- `runbooks/issue-to-pr-v2/decompose.ts`
- `runbooks/issue-to-pr-v2/lib/contract.ts`
- `runbooks/issue-to-pr-v2/lib/digest.ts`
- `runbooks/issue-to-pr-v2/lib/validate.ts`

**Read-only (v1 sources — frozen until U7):**

- `runbooks/issue-to-pr/issue-to-pr.md`
- `runbooks/issue-to-pr/README.md`
- `runbooks/issue-to-pr/issue-N-ledger.template.md`
- `runbooks/issue-to-pr/decompose.ts`

**Read-only (U1/U2 anchors — this seam consumes them):**

- `runbooks/issue-to-pr-v2/references/regression-matrix.md` (U1 anchor)
- `runbooks/issue-to-pr-v2/references/*.md` not named writable above (U2)
- `runbooks/issue-to-pr-v2/templates/*.md` (U2)

## Inspiration: sidequest cli-command-facade

The envelope and telemetry patterns are lifted from
`/Users/nathanvale/code/side-quest-engineering/packages/cli-command-facade`.
That package is too heavy to import as a dependency (1,941 lines + LogTape),
so this seam takes the **shape** of its abstractions in two small modules:

- `lib/cli-envelope.ts` — success/error envelope, structured runtime error,
  agent hint, `writeJson` writer.
- `lib/cli-diagnostics.ts` — run-id + timing tracking, `--quiet/--verbose/
  --debug` argv parsing, JSON Lines stderr emitter (no LogTape — just the
  shape, for forward compat with a U7+ LogTape integration).

## Suggested reviewer personas

- `compound-engineering:ce-correctness-reviewer` — does each command emit
  the documented JSON schema for the documented input fixtures? Are the
  no-ledger, stale-digest, version-skew, and missing-artifact paths
  exercised and correct?
- `compound-engineering:ce-api-contract-reviewer` — are the JSON envelope
  schemas stable, deterministic, and free of imperative dispatch
  instructions? Do they conform to the success/error shape contract?
- `compound-engineering:ce-kieran-typescript-reviewer` — type safety of the
  envelope generics, route id catalog, and fail-mode toggle. Any new
  `any`, lost narrowings, or circular import risk?
- `compound-engineering:ce-testing-reviewer` — happy path, no-ledger,
  stale, skew, missing-artifact, no-imperative-output coverage. Are the
  AC scenarios genuinely exercised or rubber-stamped?
- `compound-engineering:ce-scope-guardian-reviewer` — does `cli.ts` stay
  thin (no orchestration)? Does the seam keep `decompose.ts` and v1
  untouched? No U5/U6/U7/U9 scope creep?

## ADR guardrails

- **ADR 0002 (CLI emits facts, not orchestration)** — every command output
  must be a fact (state, drift, route id) or a structured error envelope.
  No imperative verbs ("run X", "do Y") in command output. Imperative
  language belongs in the hot router (U7), not here. Violations are P0.
- **R5 (CLI deterministic front door)** — same inputs must yield same JSON
  output, byte-for-byte. Tested via fixture-based assertions, not regex
  matches.
- **R6 (lib/* module split)** — new CLI logic goes in `lib/cli-envelope.ts`,
  `lib/cli-diagnostics.ts`, or `lib/route.ts`. The top-level `cli.ts` is
  the dispatcher only. Putting logic in `cli.ts` directly is P1.
- **R7 (runtime contract values in executable code)** — the `contract`
  command emits slices of `lib/contract.ts` (the const Sets and types),
  not prose. The route id catalog in `lib/route.ts` is the same pattern.
- **R10 (preserve U3 module split)** — `cli.ts` may not reach into v1
  `decompose.ts`. It uses the v2 lib surface only.
- **R11 (runbook_version)** — `state` and `diagnose` must report version
  skew. The actual `runbook_version` field is U6 work; U4 just reads it
  if present and reports the skew classification (`matched`,
  `missing`, `mismatched`, `continuation-evidence-present`).
- **R12 (regression coverage)** — every JSON command has a fixture-based
  schema assertion in `cli.test.ts`. Schema drift between code and prose
  is P1.
- **No-imperative-output rule** — `next` command returns the minimal next
  route id (a fact: which Stage 4 batch is eligible, which gate is
  blocking) but never imperative steps. Violations are P0.
- **No-Orchestrator-CLI rule** — `cli.ts` must not write the ledger, never
  invoke git mutations, never run validators that mutate. Read-only or
  validate-only. Violations are P0.

## Scoped audit prompt

````
Review the v2 CLI front door at `runbooks/issue-to-pr-v2/cli.ts`, its lib
modules (`cli-envelope.ts`, `cli-diagnostics.ts`, `route.ts`), and the
fail-mode toggle added to `lib/ledger.ts`. Cross-check against the U3
helper internals (`lib/contract.ts`, `lib/digest.ts`, `lib/ledger.ts`,
`lib/validate.ts`, `decompose.ts`) and the U1 regression matrix at
`runbooks/issue-to-pr-v2/references/regression-matrix.md`.

Audit items:

1. Does each `--json` command emit a stable top-level CliSuccessEnvelope
   or CliErrorEnvelope with `run_id`, `started_at_ms`, `duration_ms`, and
   the documented `data` shape?
2. `state --json` — does it report confirmation_state (acceptance_criteria,
   batch_contract, digests as pending|confirmed|stale|blocked), digest
   drift, version skew, current route id, required reference ids, and
   blocking gates?
3. `next --json` — does it return the minimal next route id only, with no
   imperative instructions? Any prose verb ("run", "execute", "do") in
   output is P0.
4. `contract <slice> --json` — does it emit runtime contract slices from
   `lib/contract.ts` (e.g. allowed batch statuses, finding statuses,
   execution modes) without inventing new values?
5. `diagnose <ledger> --json` — does it report inferred state, expected
   reference ids, installed artifact presence, drift between code and
   filesystem, findings-table drift, and version skew?
6. Are route ids in `lib/route.ts` matched verbatim in
   `references/ledger-and-helper.md`? Drift between code and prose is P1.
7. Does `cli.ts` stay a thin dispatcher? Any logic in cli.ts that should
   live in `lib/*` is P1.
8. Does the seam keep v1 `decompose.ts` untouched? Reaching into v1 from
   the CLI is P0.
9. Does the fail-mode toggle in `lib/ledger.ts` correctly route validator
   errors into CliErrorEnvelope for the CLI commands AND preserve the
   default exit-mode behavior for `decompose.ts`?
10. Are no-ledger, stale-digest, version-skew, missing-artifact, and
    no-imperative-output cases tested in `cli.test.ts`?
11. Is the diagnostics output (JSON Lines on stderr) cleanly separated
    from the command output (single JSON on stdout)? Mixing them is P1.

Severity:
- P0: CLI emits imperative instructions, CLI mutates state, CLI reaches
  into v1, missing required command, or runbook_version not surfaced
- P1: schema drift between code and matrix, route id drift between
  lib/route.ts and prose, logic in cli.ts that belongs in lib, stderr
  diagnostics mixing with stdout payload
- P2: missing test fixture for an AC scenario, paraphrased prose that
  weakens an invariant, agent hint missing on a recoverable error
- P3: minor formatting, ordering, or wording issues

Return findings with stable kebab-case signatures (e.g.
`cli-state-missing-version-skew-field`, `cli-next-emits-imperative-verb`,
`route-id-drift-between-lib-and-prose`).

Do NOT propose edits to v1 `runbooks/issue-to-pr/` files. Do NOT propose
edits to `runbooks/issue-to-pr-v2/references/regression-matrix.md` (U1
owns it). Do NOT propose edits to U3 internals beyond the fail-mode
toggle exports.
````

## Closing a finding without fixing it

Seam-specific close reasons (in addition to the shared
`out-of-scope-for-this-issue`, `ADR-contradicts-<id>`, and
`fails-graduation-test`):

- `not-in-u4-scope` — finding is real but belongs to U5/U6/U7/U9. Note
  the future seam in the resolution.
- `owned-by-u1-matrix` — finding is a matrix-coverage issue. Route to U1.
- `deferred-to-u6-versioning` — runbook_version-related finding whose
  fix belongs in U6 (the field itself is added there).
- `deferred-to-u7-cutover` — hot router or public cutover concern.

## /loop fallback

```
/loop 5 Follow docs/runbooks/issue-to-pr-v2-refactor/u4-cli-front-door.md.
Re-read the runbook and u4-cli-front-door-ledger.md at the start of every
turn. Echo the full ledger status table inline at the end of every turn.
```
