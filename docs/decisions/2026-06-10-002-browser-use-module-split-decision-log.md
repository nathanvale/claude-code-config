---
title: Browser-Use Module Split
slug: browser-use-module-split
type: decision-log
status: complete
date: "2026-06-10"
timezone: Australia/Melbourne
owner: browser-use-module-split
source:
  - docs/plans/2026-06-10-001-refactor-browser-use-module-split-plan.md
  - skills/browser-use/src/browser-use.ts
decision_metadata_format: fenced-yaml-per-decision
---

# Browser-Use Module Split

## Frame

`skills/browser-use/src/browser-use.ts` was a 4,449-line monolith spanning seven
plan-unit regions (runtime port, CLI driver, discovery, selection,
operation-resolve, operations, parser). An ICA seam swarm (8 agents, run
`wf_29e73262-e20`) mapped a strictly-layered, acyclic split into 8 source
modules plus a mirrored split of the 3,045-line test suite. This log captures
the decisions governing the split execution (U1-U15), separate from the
prepare/operation *contract* decisions in
`2026-06-03-browser-use-prepare-operation-decision-log.md`. This surface owns
"how the file decomposes", not "what the CLI does".

The split is behavior-preserving: no flag, contract, output envelope, exit code,
or redaction changes. Success = the existing test suite stays green at every
step.

## Decision 1: browser-use.ts stays the driver + public barrel

```yaml
id: browser-use-module-split-001
status: accepted
decided_at: "2026-06-10"
decision: keep browser-use.ts as the entry driver and re-export the public surface
owner: browser-use-module-split
source:
  - docs/plans/2026-06-10-001-refactor-browser-use-module-split-plan.md
```

Decision:

- Do not rename the entry file. `browser-use.ts` retains `runBrowserUseCli`,
  `executeCommand`, the mock/not-implemented writers, and `runForTest`.
- It re-exports the public surface (`BrowserUseRuntime`,
  `createDefaultBrowserUseRuntime`, `decodeStdinChunks`,
  `resolveOperationTarget`, `OperationResolutionInput`, `runBrowserUseMcporter`,
  `runForTest`) from the new modules via a barrel block.

Rationale:

- `package.json` `bin`/`scripts`, `build-dist.ts`, and `browser-use.test.ts` all
  reference `browser-use.ts` by path. Keeping it the entry preserves every
  external contract with zero wiring changes (R3, R4).

Consequences:

- No `bin`/build/`package.json` change is needed by the split.
- Any moved public symbol MUST be re-added to the barrel `export {}` block or the
  test import breaks. Driver-internal symbols (e.g. `runOperate`) do NOT go in
  the barrel — only test-imported symbols do.
- `bun run build` + `bun pm pack --dry-run` must emit the unchanged dist payload
  (5 files, same names) at U7 and U15.

Next:

- Each source unit re-exports its moved public symbols and verifies the full
  suite stays green.

V2 Ideas:

- None. The entry-file invariant is permanent.

## Decision 2: Four shared types sink into browser-use-core.ts (the cycle-break)

```yaml
id: browser-use-module-split-002
status: accepted
decided_at: "2026-06-10"
decision: sink Failure<A>, OutputMode, ResultKind, TargetHints into the core leaf to make the layering acyclic
owner: browser-use-module-split
source:
  - docs/plans/2026-06-10-001-refactor-browser-use-module-split-plan.md
```

Decision:

- `Failure<A>`, `OutputMode`, `ResultKind` move to `browser-use-core.ts`.
- `TargetHints` + `candidateMatchesHints` also sink to core (used by both the
  selector and `resolveOperationTarget`).
- Each surface keeps only its own
  `TargetDiscoveryFailure`/`SelectionFailure`/`OperationFailure` alias.

Rationale:

- These types were physically mis-housed (`Failure<A>` sat inside the discovery
  region; `OutputMode`/`ResultKind` sat in the driver), which would force import
  cycles on a naive split. Sinking them into a leaf makes every cross-region
  type edge point down (R1).

Consequences:

- `browser-use-core.ts` is the keystone leaf imported by all region modules.
- A cycle from a missed shared symbol surfaces immediately as a typecheck error
  in the unit that introduces it.

Next:

- Region modules import these from `./browser-use-core`, never from each other.

V2 Ideas:

- Optional mechanical acyclicity gate (madge / dependency-cruiser). Type-only
  cycles pass tsc silently, so a runtime-import-graph check would harden this.
  Out of scope for the split (see Notes).

## Decision 3: ParsedBrowserUseCommand stays in the driver; regions type-only import it from the barrel

```yaml
id: browser-use-module-split-003
status: accepted
decided_at: "2026-06-10"
decision: keep ParsedBrowserUseCommand in the driver until U7, region modules use a type-only barrel import
owner: browser-use-module-split
source:
  - skills/browser-use/src/browser-use-selection.ts
  - 3-reviewer adversarial assessment (this session)
```

Decision:

- `ParsedBrowserUseCommand` stays defined in `browser-use.ts` (the driver)
  through U6.
- Region modules (discovery, selection, operations) consume it via
  `import type { ParsedBrowserUseCommand } from "./browser-use"` (the barrel).
- The barrel carries a temporary `type ParsedBrowserUseCommand` export for this.
- At U7, when the parser is carved, the type relocates to
  `browser-use-parser.ts`; the driver re-exports it from parser via the barrel so
  the region modules' temporary `import type ... from "./browser-use"` keeps
  resolving unchanged. Region imports may then optionally repoint to
  `./browser-use-parser`.

Rationale:

- The plan's KTD2 is internally contradictory: it says the type "moves to the
  parser (where it's produced)", but the DAG forbids
  discovery/selection/operations from importing parser, and those regions all
  consume the type as a handler param.
- Three adversarial reviewers assessed the placement. Findings:
  - Sinking to `command-contract.ts` is a real cycle
    (`core -> router-model -> command-contract -> core` via `OutputMode`).
    REJECTED.
  - Sinking to `core` is acyclic but pollutes the CLI-agnostic leaf. REJECTED.
  - WINNER: keep in driver, type-only barrel import. Type-only imports erase at
    runtime, so there is no runtime cycle (the U1-sanctioned temporary-import
    precedent, plan lines 198-201).

Consequences:

- Region modules carry a `// Temporary: ParsedBrowserUseCommand relocates to the
  parser at U7 (KTD2)` comment over the type-only barrel import.
- Verified clean at U6: the operations module typechecks with zero errors and no
  cycle using this pattern.
- This decision corrects KTD2's literal text. Future agents should treat THIS
  log as authoritative over the plan's KTD2 wording.

Next:

- U7 relocates the type to the parser and re-exports it through the barrel
  unchanged.

V2 Ideas:

- After U7, decide whether to keep the barrel re-export permanently or repoint
  all region imports directly to `./browser-use-parser`.

Resolution (post-split review, 2026-06-10):

- Realized the V2 idea. `discovery`/`selection`/`operations` now import
  `ParsedBrowserUseCommand` directly from `./browser-use-parser` (the leaf that
  owns it), the `// Temporary` comments are removed, and the driver's barrel
  re-export of the type is dropped (it was added only to service the transitional
  up-imports, and the type was not part of the pre-split public surface).
- The type-level graph now matches the value-level graph: every region-module
  arrow points down, so the "every arrow points down, acyclic" claim holds
  literally, not just at runtime.

## Decision 4: resolveOperationTarget ships inside selection, not operations

```yaml
id: browser-use-module-split-004
status: accepted
decided_at: "2026-06-10"
decision: place resolveOperationTarget in browser-use-selection.ts, with operations importing down into it
owner: browser-use-module-split
source:
  - docs/plans/2026-06-10-001-refactor-browser-use-module-split-plan.md
```

Decision:

- `resolveOperationTarget` (+ `OperationTargetHints`, `OperationResolutionInput`,
  `OperationResolution`) lives in `browser-use-selection.ts`.
- `browser-use-operations.ts` imports it down from selection.

Rationale:

- It depends on `loadSelectedState`/`resolveStatePath` (selection-owned) and
  `candidateMatchesHints` (core). Operations imports down into selection; the
  reverse never happens (KTD3). Stranding it in operations would invert the
  dependency.

Consequences:

- The selection barrel re-exports `resolveOperationTarget` +
  `OperationResolutionInput` (test-imported, public surface).
- Operations imports 8 selection symbols, never the reverse.

Next:

- Confirmed in force at U5 (selection extracted) and U6 (operations imports it).

V2 Ideas:

- None.

## Decision 5: Test split uses duplicate-carve-verify-delete with test-count delta as the primary guard

```yaml
id: browser-use-module-split-005
status: accepted
decided_at: "2026-06-10"
decision: gate the test carve on per-step test-count delta, not oracle greenness
owner: browser-use-module-split
source:
  - docs/plans/2026-06-10-001-refactor-browser-use-module-split-plan.md
  - adversarial review of KTD4 (planning session)
```

Decision:

- Copy `browser-use.test.ts` -> `browser-use.full.test.ts` (frozen oracle, U8).
- Carve per-module suites out of the original (U9-U14).
- Delete the oracle only in the final unit (U15), after explicit count + coverage
  equivalence.
- The real per-step guard is **test-count delta at every carve unit**: after each
  carve, the moved-out block's test count must appear in the new file (count
  original-before vs new-file-after; they must match).
- Carved files import **directly from their module** *where the module exposes a
  pure seam* — `browser-use-transport.test.ts` (`runBrowserUseMcporter`) and
  `browser-use-selection.test.ts` (`resolveOperationTarget`, `runScopedKey`) do
  this, so their coverage attributes to the module under test. Handler modules
  whose only interface is the CLI envelope (`parser`, `discovery`, `operations`)
  are driven through `runForTest` from the barrel instead — there is no
  pure-function surface to import — so their line coverage attributes to the
  driver, not the module file. This is intentional, not a gap: the behavioral
  assertions are preserved either way; only the attribution differs.

Rationale:

- Because oracle and carved tests both import through the same barrel
  (`./browser-use`), the oracle staying green proves only that *barrel wiring is
  intact* — it does NOT prove a carved file contains its assertions (an empty
  carved file would still pass the oracle).
- Coverage equivalence (U15) is a backstop, but line-coverage is driven by
  driver-level tests and would NOT catch a dropped fine-grained assertion that
  hits the same lines. So count delta is primary, coverage secondary.

Consequences:

- Every carve unit (U10-U14) must run the count-delta check explicitly.
- Shared test helpers must be extracted before any carve (Decision 6) or carved
  files fail to compile.

Next:

- U8 creates the oracle; U16 extracts helpers; U9-U14 carve with the delta check.

V2 Ideas:

- None.

## Decision 6: Shared test helpers extracted before carving

```yaml
id: browser-use-module-split-006
status: accepted
decided_at: "2026-06-10"
decision: extract cross-block test fixtures into browser-use-test-helpers.ts before any per-module carve
owner: browser-use-module-split
source:
  - docs/plans/2026-06-10-001-refactor-browser-use-module-split-plan.md
```

Decision:

- Extract the top-level shared helpers (`makeRuntime`, `capturingRuntime`,
  `parseJson`, `okCommand`, `commandVector`, `commandJsonArgs`, `stateRunKey`,
  `contractFlags`, `parsedWrite`, `enoent`) AND the cross-region envelope
  builders (`adapterProofEnvelope`, `routeSuccessEnvelope`) into
  `browser-use-test-helpers.ts` (U16) before U9-U14.
- Point both `browser-use.test.ts` and the oracle at the new helper module.

Rationale:

- The test's describe blocks do NOT map 1:1 to modules at the fixture level:
  `makeRuntime` (31 uses across U3/U4/U5/U6), `parseJson` (84 uses), and the
  envelope builders (defined in the U5 region but used inside U7 blocks) are
  shared. Without extraction, every carved file fails to compile (KTD5).

Consequences:

- U16 blocks U9-U14.
- The helper module imports the public barrel + `command-contract`.

Next:

- Run U16 immediately after U8.

V2 Ideas:

- None.

## Decision 7: Non-plan helper relocations placed by consumer

```yaml
id: browser-use-module-split-007
status: accepted
decided_at: "2026-06-10"
decision: relocate small shared field helpers to their owning module by consumer count, even when the plan did not list them
owner: browser-use-module-split
source:
  - commit 4743068 (U4)
```

Decision:

- When the source split surfaces a small shared helper the plan did not enumerate,
  place it in the module that owns its consumer(s):
  - `isBrowserAdapterId` -> core (shared guard, multiple consumers).
  - `parseAdapterCapabilities` -> discovery (single consumer).
- Watch for similar "Small shared field helpers" in the driver that U6/U7 must
  place by consumer.

Rationale:

- The plan's move-lists are not exhaustive at the helper level. Placing a helper
  by consumer preserves the acyclic layering without inventing a new module.

Consequences:

- Two such relocations happened in U4 (not listed in the plan). Future units
  apply the same by-consumer rule rather than stranding helpers in the driver.

Next:

- U6/U7 place any remaining small shared helpers by consumer.

V2 Ideas:

- None.

## Notes

- **Outcome (2026-06-10): complete.** U1-U15 landed; all 7 decisions held with no
  reversal. Source is 8 modules (driver `browser-use.ts` 509 lines, down from
  4,449); tests are 6 per-module suites + slimmed driver + shared helpers. Final
  count reconciliation: core 1 + parser 19 + transport 15 + discovery 24 +
  selection 62 + operations 19 + driver 5 = 145, equal to the deleted oracle —
  zero assertions lost or duplicated. Coverage byte-identical with/without the
  oracle. Build emits the unchanged 5-file dist / 7-file pack payload. Two
  cross-region test helpers the plan did not enumerate were promoted to
  `browser-use-test-helpers.ts` under Decision 6 (`listPagesStdout` at U11,
  `TARGETS_CONTRACT` at U12) — the by-consumer rule of Decision 7 applied to
  fixtures.
- **Per-unit gate (in force every unit):** `489 tests, exactly 1 failure, and
  that failure is `preflight-warm-chrome.test.ts > "docs teach continuation
  precedence"`` (pre-existing red from SKILL.md edit `e401f43`, unrelated to the
  split). If a SECOND test goes red, a symbol moved wrong — fix the move, do not
  change behavior.
- **Method (move-only, behavior-preserving):** map region with `grep -n` section
  headers; find the export surface (symbols referenced outside the region);
  assemble the new module (slice region lines + prepend import block + prefix
  `export` on externally-consumed decls); delete region from driver (bottom-up
  when non-contiguous); add driver import + barrel re-export for public symbols;
  `bunx tsc` to surface missing imports; `bunx biome check` to surface unused
  imports left in the driver; run the suite; commit.
- **MCP runners disconnected this session** — use sanctioned wrappers: typecheck
  `bunx tsc --noEmit -p tsconfig.json`; tests
  `bash ../../skills/test-runner/src/test-runner.sh run -- src`; lint
  `bunx biome check src/`; build contract `bun run build` + `bun pm pack
  --dry-run`.
- **No mechanical acyclicity gate exists.** Reviewers flagged that type-only
  cycles pass tsc silently. Optional hardening: a madge/dependency-cruiser rule.
  Out of scope for the split.
- **Unresolved follow-ups (not decisions):** reconcile the pre-existing
  `preflight-warm-chrome.test.ts` red with the tightened SKILL.md; promote memory
  `feedback-adversarial-before-heal` into `AGENTS.md` via
  `/prompt-system-workflow`. (`skills/browser-use/CLEANUP_PLAN.md` deleted
  2026-06-10.)
