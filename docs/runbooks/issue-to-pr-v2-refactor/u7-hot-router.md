# Runbook: V2 shadow hot router (U7)

**Seam:** A new hot-router prose file at
`runbooks/issue-to-pr-v2/issue-to-pr.md` plus targeted updates to the
existing per-stage references and the ce-plan addendum template. The
router consumes the U4/U5/U6 CLI surface (state, next, contract,
diagnose, packet) and emits a routing decision against durable ledger
state. The v1 hot file at `runbooks/issue-to-pr/issue-to-pr.md` stays
runnable as a reference until U9's public cutover.

**Central risk: action-on-stale-state.** Resumed runs that route from
conversation memory instead of `cli.ts state` will commit work against a
stale view of confirmation state, digests, version skew, or install
presence. U7 enforces "facts before action" by making
`cli.ts state <ledger> --json` the first non-read operation in every
turn and routing exclusively off the returned envelope. Anything the
operator wants to know that isn't on the envelope is a U7 prose change,
never an inference.

**Ledger:** [u7-hot-router-ledger.md](u7-hot-router-ledger.md)

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Files in scope

**Writable (this seam's contract surface):**

- `runbooks/issue-to-pr-v2/issue-to-pr.md` (new; the v2 hot router prose
  file — one-paragraph purpose, ledger location, core invariants,
  reference-loading table, start-every-turn block, stage shells with
  inputs/required reference/CLI facts/action summary/exit/stop
  conditions, router state enumeration, stop-and-ask conditions, hatch
  names, ADR pointers)
- `runbooks/issue-to-pr-v2/references/stage-1-pick-issue.md` (modify:
  update CLI invocation references from `decompose.ts` to `cli.ts`
  where the hot router consumes them; do NOT restate U2 prose)
- `runbooks/issue-to-pr-v2/references/stage-2-plan.md` (modify: same
  CLI surface alignment + add the ce-plan addendum template pointer)
- `runbooks/issue-to-pr-v2/references/stage-3-decompose.md` (modify:
  align with `cli.ts contract` slices and the U6 version-skew gate
  semantics)
- `runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md` (modify:
  align with `cli.ts packet builder/proposer/validator` flow; surface
  the install-presence + version-skew gates)
- `runbooks/issue-to-pr-v2/references/stage-5-final-review.md` (modify:
  align with `cli.ts packet patch-proposal` flow; keep Stage 5 read-only
  per the plan)
- `runbooks/issue-to-pr-v2/references/stage-6-ship.md` (modify: align
  with `cli.ts state` ship gate semantics)
- `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` (modify:
  point the read trigger at the v2 hot file; align "Run helpers from
  the target repo root" with the `cli.ts` invocation form)
- `runbooks/issue-to-pr-v2/templates/ce-plan-addendum.md` (modify: align
  with U5 packet rendering boundaries and U6 ledger template)
- `runbooks/issue-to-pr-v2/lib/cli-diagnostics.ts` (modify: wire LogTape
  + AsyncLocalStorage run-id propagation + redactor hook per the U4
  observability follow-on documented in the parent plan U7 section)
- `runbooks/issue-to-pr-v2/lib/cli-diagnostics.test.ts` (modify: cover
  the LogTape category tree, the AsyncLocalStorage context propagation,
  and the redactor behavior)

**Read-only (U2/U3/U4/U5/U6 surface — preserve except where named writable):**

- `runbooks/issue-to-pr-v2/lib/contract.ts`
- `runbooks/issue-to-pr-v2/lib/ledger.ts`
- `runbooks/issue-to-pr-v2/lib/route.ts`
- `runbooks/issue-to-pr-v2/lib/packets.ts`
- `runbooks/issue-to-pr-v2/lib/cli-envelope.ts`
- `runbooks/issue-to-pr-v2/lib/digest.ts`
- `runbooks/issue-to-pr-v2/lib/validate.ts`
- `runbooks/issue-to-pr-v2/cli.ts` (U4/U5/U6 envelope — U7 consumes it
  but does not change shape)
- `runbooks/issue-to-pr-v2/decompose.ts`
- `runbooks/issue-to-pr-v2/issue-N-ledger.template.md` (U6 template)
- All `runbooks/issue-to-pr-v2/references/*.md` not named writable
  above (includes `builder-dispatch.md`, `findings-and-validators.md`,
  `host-adapters.md`, `regression-matrix.md`)
- All `runbooks/issue-to-pr-v2/templates/*.md` not named writable above

**Read-only (v1 sources — frozen until U9's public cutover):**

- `runbooks/issue-to-pr/issue-to-pr.md`
- `runbooks/issue-to-pr/README.md`
- `runbooks/issue-to-pr/issue-N-ledger.template.md`
- `runbooks/issue-to-pr/decompose.ts`

**Read-only (anchors — this seam consumes them):**

- `runbooks/issue-to-pr-v2/references/regression-matrix.md` (U1 anchor)
- `docs/plans/2026-05-22-002-refactor-issue-to-pr-v2-runbook-plan.md`
  (U7 plan section)

## What U7 is NOT — explicit anti-list

These belong to other units and must not be implemented here:

- **Public cutover of `runbooks/issue-to-pr/issue-to-pr.md` (U9
  territory).** U7 lands the shadow v2 hot file; U9 flips the public
  entry point. U7 must not modify v1 sources.
- **Regression probes (U9).** U7 makes the v2 routing reachable; U9
  exercises it via probes.
- **New `lib/*` modules.** U7 wires the existing U3-U6 modules into the
  hot router; it does not add new lib surface. The single exception is
  the `cli-diagnostics.ts` upgrade (LogTape + AsyncLocalStorage +
  redactor) called out in the writable list — that file already exists
  from U4 and U7 swaps the emitter under the hood without changing the
  emitted record shape.
- **CLI envelope shape changes.** The U4 envelope (`schema_version: "1"`,
  `status`, `run_id`, `started_at_ms`, `duration_ms`, `data`) and the
  U5/U6 nested data shapes are frozen for U7. Any drift is a P0.
- **Ledger write paths.** The CLI remains read-only per ADR 0002.
  R-no-orchestrator-CLI. U7's router prescribes when the operator
  appends to `## Notes` or rewrites `## Findings`; it does not author a
  CLI write command.
- **Live v1 ledger migration.** U7 may reference the v2 ledger template
  but must not migrate any `docs/runbooks/issue-to-pr/issue-*-ledger.md`
  file under the v2 contract.
- **New routing semantics.** Every route decision must be derivable
  from `classifyRoute` in `lib/route.ts`. If U7 prose needs a route the
  classifier does not emit, that is a U7 finding that must be opened
  against the classifier or absorbed as a "stop and ask" condition, not
  reinvented in the hot file.

## Suggested reviewer personas

Always-on (every sweep):

- `compound-engineering:ce-correctness-reviewer` — does every route
  state enumerated in the hot file map to a `RouteId` from `ROUTE_IDS`?
  Does the start-every-turn block actually call `cli.ts state` before
  any other action? Does the version-skew + install-presence gate fire
  before any Builder, Validator, or ship work?
- `compound-engineering:ce-api-contract-reviewer` — does the hot file
  use `cli.ts` command names and expected facts only, never internal
  helper implementation details? Does it consume the U4/U5/U6 envelope
  shape verbatim?
- `compound-engineering:ce-scope-guardian-reviewer` — does the diff
  respect the U7 anti-list (no v1 hot-file edits, no new lib modules,
  no envelope changes, no ledger writes, no regression probes)?
- `compound-engineering:ce-testing-reviewer` — are the seven plan-listed
  test scenarios (happy resumed run; ce-plan addendum reference; Stage
  4 references; stale digest routing; version-skew stop; missing
  reference diagnosed; Stage 5 P0/P1 patch routing) covered by either
  a CLI test, a route classifier test, or a probe-friendly anchor in
  the hot file?
- `compound-engineering:ce-security-sentinel` — can the LogTape
  redactor be bypassed by a hostile ledger value? Does the
  AsyncLocalStorage context propagation correctly bound run-id leakage
  across concurrent invocations (relevant if U7 introduces any parallel
  CLI call sites)?

Conditional:

- `compound-engineering:ce-kieran-typescript-reviewer` — added when the
  `lib/cli-diagnostics.ts` diff grows beyond ~150 lines, since the
  LogTape + AsyncLocalStorage wiring is load-bearing for all U7+
  diagnostics.

## ADR guardrails

- **ADR 0001 (Orchestration / mechanic split)** — the hot router is
  orchestration prose; the CLI is the mechanic. The hot file must not
  re-implement classification logic that lives in `lib/route.ts`. If a
  decision needs facts the CLI does not emit, file a finding against
  the CLI rather than inventing the decision in prose.
- **ADR 0002 (CLI emits facts, not orchestration)** — preserved. U7
  reads facts and decides; the CLI never says "run X" or "execute Y".
- **R-no-orchestrator-CLI** — preserved. The CLI is still read-only.
- **R3 (lib/* module split)** — preserved. U7 does not add new lib
  surface; the only `lib/*` change is the `cli-diagnostics.ts` emitter
  upgrade.
- **R8 (deterministic from templates + ledger)** — preserved. Same
  ledger + same filesystem state MUST yield identical route_id and
  blocking_gates. The hot file's stage-shell prose must not introduce
  any mtime / inode / fs-order dependency.
- **R10 (preserve U3/U4/U5/U6 split)** — preserved. No re-exports from
  `lib/packets.ts`, `lib/ledger.ts`, or `lib/route.ts` added.
- **R11 (runbook_version contract)** — the hot router must honor U6's
  skew classification. A `missing | mismatched` skew without
  continuation evidence stops the workflow before any stage work.

## Per-snapshot contracts (MUST include / MUST NOT leak)

The hot router itself does NOT add new CLI envelope fields. The
contracts below describe what the hot router must do with the
already-emitted U4/U5/U6 envelope.

### `cli.ts state` as the first non-read operation

**MUST happen:**

- Every resumed turn calls `cli.ts state <ledger> --json` BEFORE
  reading frontmatter, batches, findings, or notes from conversation
  memory.
- The hot file routes off the `route_id` field, the
  `blocking_gates` list, and the `installed_artifact_presence` shape.

**MUST NOT happen:**

- Inferring the route from conversation context.
- Routing off `frontmatter_status` alone (U4 documented that
  confirmation is anchored to digests, not status strings).
- Acting on a `route_id` not present in `ROUTE_IDS`.

### Version-skew + install-presence stop-required gate

**MUST happen:**

- If `runbook_version_skew` is `missing` or `mismatched` and no
  continuation-evidence row exists, the hot router stops and asks the
  operator. The orchestrator's user-facing message is U7's prose
  responsibility.
- If `installed_artifact_presence.all_present` is `false`, the hot
  router stops and tells the operator which roots are missing.

**MUST NOT happen:**

- Dispatching any Builder / Validator / ship work past either gate.
- Re-classifying skew based on conversation memory.

### LogTape + AsyncLocalStorage emitter upgrade

**MUST include:**

- LogTape-backed `getLogger(category).log(level, message, attributes)`
  replacing the U4 direct `stderr.write` path. Category tree rooted at
  `issue-to-pr-v2` so consumers can filter `issue-to-pr-v2.cli.state`
  etc.
- `configureCliDiagnostics({ categoryRoot, diagnosticWriter, redact })`
  entrypoint mirroring the sidequest pattern.
- `withCliDiagnosticContext(ctx, () => …)` +
  `getCurrentCliDiagnosticContext()` so deeply-called helpers can emit
  diagnostics without threading `run_id` through every signature.
- A `CliDiagnosticRedactor` callback so an Issue-to-PR-v2-specific
  redactor can scrub credentials / tokens / secrets before records hit
  stderr.

**MUST NOT leak:**

- Any change to the emitted record shape (`run_id`, `started_at_ms`,
  `duration_ms`, `level`, `category`, `event`, `attributes`, `message`).
  The contract from U4 is forward-compatible.
- Any change to the `--quiet | --verbose | --debug` verbosity ladder.
- Any change to the CLI envelope on stdout (LogTape only affects the
  stderr JSON-Lines diagnostic stream).

### Hot-file size budget

**MUST hold:**

- `runbooks/issue-to-pr-v2/issue-to-pr.md` is within 400-500 lines OR
  carries a worked overflow enumeration explaining why a specific
  invariant required more lines.

**MUST NOT happen:**

- Cutting safety invariants to fit the budget.
- Inlining hatch behavior detail that belongs in
  `findings-and-validators.md`.

## Scoped audit prompt

````text
Review U7 shadow v2 hot router in
`runbooks/issue-to-pr-v2/issue-to-pr.md`, the writable references
(`stage-1-pick-issue.md` through `stage-6-ship.md`,
`ledger-and-helper.md`), the ce-plan addendum template, and
`runbooks/issue-to-pr-v2/lib/cli-diagnostics.ts` (LogTape +
AsyncLocalStorage + redactor wiring). Tests in
`lib/cli-diagnostics.test.ts` and existing CLI test coverage.

Audit items:

1. Does the hot file call `cli.ts state <ledger> --json` as the first
   non-read operation in every resumed turn?
2. Does every route enumerated in the hot file map 1:1 to a `RouteId`
   from `ROUTE_IDS`? Are there any orphan states in the prose?
3. Does the version-skew gate stop ALL stage work when skew is
   `missing` or `mismatched` without continuation evidence?
4. Does the install-presence gate stop ALL stage work when
   `all_present: false`?
5. Does the hot file use only `cli.ts` command names and the documented
   envelope facts? Are there any leaks of `decompose.ts` flag names or
   internal `lib/*` symbols?
6. Is Stage 5 read-only with patch batches routed back to Stage 4?
7. Is the hot file within the 400-500 line budget OR does it carry a
   worked overflow enumeration?
8. Does every reference link in the hot file have a "read when"
   trigger?
9. Does the LogTape upgrade preserve the U4 record shape exactly?
10. Does the redactor have at least one test that exercises a hostile
    ledger value (credential-like pattern in a builder commit ref or
    finding summary)?
11. Does the AsyncLocalStorage context propagation correctly bound
    `run_id` across concurrent invocations?
12. Is the seam read-only with respect to v1 sources, the U4 envelope
    shape, and the existing lib module split?

Severity:
- P0: hot file routes from conversation memory instead of `cli.ts
  state`, version-skew gate bypassed, install-presence gate bypassed,
  envelope shape change, ledger mutation by the CLI, v1 source edit
- P1: orphan route state, LogTape record shape drift, missing
  AsyncLocalStorage scoping, missing redactor
- P2: budget overflow without worked enumeration, missing test for one
  of the seven plan scenarios, reference link without "read when"
- P3: minor formatting

Return findings with stable kebab-case signatures (e.g.
`hot-file-routes-from-memory-on-resume`, `version-skew-gate-bypassed`,
`logtape-record-shape-drift`).

Do NOT propose edits to v1 `runbooks/issue-to-pr/` files. Do NOT
propose regression probes (U9). Do NOT propose new CLI envelope fields.
````

## Closing a finding without fixing it

Seam-specific close reasons:

- `not-in-u7-scope` — finding belongs to U9 (public cutover, regression
  probes) or a future seam.
- `deferred-to-u9-probes` — finding is about exercising the routing in
  a regression probe.
- `deferred-to-u9-cutover` — finding is about flipping the public entry
  point.

## /loop fallback

```text
/loop 5 Follow docs/runbooks/issue-to-pr-v2-refactor/u7-hot-router.md.
Re-read the runbook and u7-hot-router-ledger.md at the start of every
turn. Echo the full ledger status table inline at the end of every turn.
```
