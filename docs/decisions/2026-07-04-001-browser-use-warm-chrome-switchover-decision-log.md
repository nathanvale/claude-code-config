---
slug: browser-use-warm-chrome-switchover
status: accepted
surface: browser-use ↔ @side-quest/warm-chrome switchover
source:
  - runtime/warm-chrome/TASKS.md (P1 browser-use switchover)
  - runtime/warm-chrome/tests/parity.test.ts
  - skills/browser-use/src/preflight-warm-chrome.ts
  - skills/browser-use/src/browser-adapter-router-prepare.ts
  - docs/decisions/2026-07-03-warm-chrome-runtime-package-definition.md
owner: nathanvale
escalation: ADR (hard to reverse, surprising without context, real trade-off)
date: 2026-07-04
---

# Browser-use ↔ Warm Chrome switchover

## Frame

The P1 switchover routes `skills/browser-use`'s Warm Chrome preflight through the
`@side-quest/warm-chrome` package and retires the legacy
`skills/browser-use/src/preflight-warm-chrome.ts` implementation. Grilled
against the parity report, both preflight surfaces, the adapter router's proof
consumer, the package/consumer manifests, and the built dist. This log records
the eight accepted decisions and the reasons alternatives were rejected.

Governing invariants honored: `AGENTS.md` drift anti-pattern ("do not mark
switchover closed while `preflight-warm-chrome.ts` remains authoritative") is
satisfied because the shim makes the file non-authoritative in the same change
that closes the task. `rules/browser-access.md` becomes true in practice
(browser-use actually gates on the package). Ownership direction is the deciding
principle throughout: the package publishes the canonical contract; the consumer
(browser-use) adapts to it.

## Decisions

```yaml
decision: switchover-shape-thin-shim
status: accepted
```

### Decision — Switchover shape: thin re-export shim

Rewrite `skills/browser-use/src/preflight-warm-chrome.ts` to a ~10-line
delegator that imports `main` (and `createDefaultRuntime`) from
`@side-quest/warm-chrome` and calls it. Bin name, dist entrypoint, and argv
contract stay identical; only the body changes. The old ~2030-line
implementation is deleted in the same change.

**Rationale.** Smallest consumer blast radius — the `package.json#bin`, the
`build-dist.ts` entrypoint, `SKILL.md` step 1, and `references/warm-chrome.md`
owner paths all keep working unchanged. Repointing the bin at the package CLI
(rejected) moved dist build, bundle markers, references, and command-contract at
once — largest surface. Adapter-level in-process call (rejected) left the
standalone `preflight-warm-chrome check` CLI on the old impl, failing the
task's done-when (legacy surface not retired).

**Consequences.** The old file's git identity is destroyed. `parity.test.ts`
imports `runForTest` from that file, so its fate must be resolved in the same
change (see next decision).

**Next.** Author the shim; bridge env (Decision 7) inside it.

**V2 Ideas.** None.

```yaml
decision: parity-verify-then-port-gaps
status: accepted
```

### Decision — Parity fate: verify coverage, port the 5 gaps to station tests, delete parity

Step 0 (done, read-only): diffed the 50 parity `new`-side outcomes against the
existing `*-stations.test.ts`. Result: 28 of 33 distinct `new` reasons already
pinned by station tests; **5 are not** — all launch/repair post-mutation
stations: `readiness_timeout`, `prior_launch_mid_startup` (→
`launch.spawned_unverified`), `foreign_listener_on_port`, `profile_not_owned`,
`devtools_active_port_symlink` (→ `repair.unrepairable`). Decision: port those 5
scenarios into `launch-stations.test.ts` / `repair-stations.test.ts` as native
fixtures, then delete `parity.test.ts` and the old implementation wholesale.

**Rationale.** `AGENTS.md` owns station behavior in `*-stations.test.ts` keyed
to the Branch Station Catalog — one home per station. A surviving
`browser-entry-golden.test.ts` (rejected: convert-to-golden) would be a second
home for station truth (drift risk). Keeping all 50 rows (rejected: B-full)
freezes ~40 assertions redundant with station tests, against `scope-discipline`
and `dependency-and-file-hygiene`. After the shim, `runForTest` and `main` are
the same code path, so parity would measure the package against itself — a
category error; the harness is migration scaffold, now spent.

**Consequences.** The 14 `INTENDED_DIVERGENCES` (already written as
consumer-facing prose) become this decision log's divergence record. The
`CONTEXT.md` "Parity harness" term dies with the harness.

**Next.** Execution gate before any `git rm`: confirm each of the 5 station
tests reaches its reason through the full handler/seam path (reason-string
match is a proxy; if a station test shortcuts the spawn/readiness path, porting
the parity fixture is additive, not redundant).

**V2 Ideas.** None.

```yaml
decision: router-adopts-package-contract
status: accepted
```

### Decision — Contract identity: router adopts the package contract

The adapter router gates on `data.contract == "browser-use.warm-chrome-preflight"`
(`browser-adapter-router-prepare.ts:303`); the package emits
`data.contract_id == "warm-chrome.browser-entry"`. Update the router to import
`WARM_CHROME_CONTRACT_ID` from the package and read `data.contract_id`. Retire
browser-use's `WARM_CHROME_PREFLIGHT_CONTRACT_ID` constant.

**Rationale.** A naive shim swap breaks the router on two counts — wrong field
name (`contract` absent) and wrong value — routing every browser task to
`warm_chrome_proof` recovery. The package publishes the canonical contract
(`warm-chrome.browser-entry` is already the `CONTEXT.md` term and the
`browser-access.md` rule name); the consumer adapts. Shim-forges-old-id
(rejected) builds a permanent lie over new proof. Package-emits-both-fields
(rejected) leaks a consumer's legacy name into the package's public envelope
forever. Both invert ownership.

**Consequences.** The router's binary proof gate (`status === "ok"` +
`data.ok === true` + contract match) is the ONLY consumer discrimination —
confirmed no consumer branches on exit 2 vs 20 or on launch success-by-exit-code.
So the exit-2→20 and already-running→ok divergences are invisible to the router;
they surface only to a human/agent reading the exit code at a shell.

**Next.** Update `prepare.ts`, drop the const in `command-contract.ts`, fix the
router test fixture (`browser-adapter-router.test.ts:582`). Sweep for other
readers of the old `data.contract` field before deleting the const.

**V2 Ideas.** None.

```yaml
decision: source-run-workspace-private-package
status: accepted
```

### Decision — Resolution: source-run via workspace; package stays private

Nothing is published today — browser-use runs from the Bun workspace despite its
vestigial `private:false`/`publishConfig`/`prepack`. The shim resolves
`@side-quest/warm-chrome` via workspace resolution; the package stays
`private:true`. Add `@side-quest/warm-chrome` as a `workspace:*` dependency of
browser-use.

**Rationale.** Collapses three blockers found in the manifests: publishability
conflict (a public package cannot depend on a private unpublished one),
must-make-package-public (rejected: big scope — a second published artifact with
its own release cadence just to unblock a cutover), and standalone-install break.
Confirmed by the user: "nothing's published, everything's working from the Bun
workspace."

**Consequences.** browser-use gains a `workspace:*` dep. Package ownership and
posture unchanged.

**Next.** Add the dependency to `skills/browser-use/package.json`.

**V2 Ideas.** If browser-use is ever genuinely published, revisit — bundling
(the package inlines cleanly, see Decision 6 note) or making the package public.

```yaml
decision: build-guard-no-conflict
status: accepted
```

### Decision — Build guard: no conflict; leave build-dist.ts untouched

Investigation (against the built 3 Jul dist) showed the guard
(`build-dist.ts:69`, `text.includes("@side-quest/cli-command-facade")`) checks
for an import specifier string that Bun **fully erases** during bundling: the
built `preflight-warm-chrome.js` has 0 occurrences of the facade string yet
inlines its symbols (7×). Bundling `@side-quest/warm-chrome` behaves identically
— Bun inlines the package and its transitive facade with no surviving
`@side-quest/...` specifier. The guard will not fire. Leave it untouched.

**Rationale.** An earlier plan branch (re-scope the guard / drop the dist build)
was **voided by evidence** — its premise ("inlining the facade trips the guard")
was wrong. The facade has imported and bundled cleanly for a long time by this
exact mechanism. No re-scoping needed; `scope-discipline` says leave it.

**Consequences.** browser-use builds exactly as today. Note: the guard is
arguably weak (it can only fire on an un-bundled build, which is not how
browser-use ships) — but hardening it is out of switchover scope.

**Next.** During execution, build once with the warm-chrome import present and
confirm the guard passes (verify, don't assume).

**V2 Ideas.** Optionally harden the guard to assert warm-chrome proof code is
present (from the package), not merely that a string is absent. Separate task.

```yaml
decision: shim-bridges-env-namespace
status: accepted
```

### Decision — Env namespace: shim bridges BROWSER_USE_* → WARM_CHROME_*

The package reads `WARM_CHROME_{CDP_PORT,PROFILE_DIR,RUN_ID}`; browser-use
threads `BROWSER_USE_*` across its whole command family (router, adapter,
selection all read `BROWSER_USE_RUN_ID` for cross-command diagnostic
correlation). The shim maps browser-use's env vars into the runtime it
constructs for `main()`, with `WARM_CHROME_X ?? BROWSER_USE_X` precedence and
only setting a key when its source is defined.

**Rationale.** This is the one genuinely SILENT divergence — a caller setting
`BROWSER_USE_CDP_PORT=9250` would be ignored (new `main()` falls back to 9222)
with no error, and `BROWSER_USE_RUN_ID` correlation would fragment at the
preflight boundary. The bridge preserves browser-use's public `BROWSER_USE_*`
contract (dotfile exports exist per the port-lifecycle plan) AND the package's
clean `WARM_CHROME_*` ownership. Same ownership direction as Decision 4: the
consumer's own code (the shim) adapts to the package. Package-reads-BROWSER_USE_*
(rejected) and full-rename-to-WARM_CHROME_* (rejected: breaks dotfiles +
cascades the run-id rename across the family) both fail. The old preflight
already did `applyEnvRunId` from `BROWSER_USE_RUN_ID`, so the bridge is
behavior-preserving.

**Consequences.** Small, honest translation logic in the shim — legitimately the
shim's job as the namespace boundary.

**Next.** Implement the `??` bridge in the shim; keep the run-id mapping.

**V2 Ideas.** None.

```yaml
decision: defer-platform-guard-macos-only
status: accepted
```

### Decision — Platform guard: defer; switch over macOS-only

The old preflight refused non-darwin with `unsupported_platform` exit 1 before
any probe; the new package has no platform guard and fails deep in the proof
chain on Linux with a misleading station. User confirmed the toolchain is
macOS-only in practice (no CI/remote/Linux execution). Defer the guard; keep P2
"Platform guard decision" in `TASKS.md`; proceed with the switchover unchanged.

**Rationale.** The deep-chain failure never happens in reality if nothing runs
off macOS. Landing a package platform station now (rejected: A) adds a station +
test + doc-drift run for a path that never executes. Guarding in the shim
(rejected: C) splits the platform contract — the package's own `warm-chrome` bin
would still fail deep on Linux. macOS-only is intrinsic to this package
(`DEFAULT_CHROME` hardcodes the macOS app path), so IF a guard is ever needed it
belongs in the package (option A), at exit 20 not exit 1.

**Consequences.** A documented, tripwired gap instead of a silent one.

**Next.** This log records the assumption: **macOS-only execution; if Linux/CI
is ever added, restore the guard as a package station (exit 20 +
no_adapter_fallback) before relying on it.**

**V2 Ideas.** Package platform station (non-darwin → `unsupported_platform`,
exit 20) when cross-platform execution is introduced.

```yaml
decision: closure-doc-set-and-gates
status: accepted
```

### Decision — Closure: the doc-set and gates that move in the same pass

The switchover crosses several `AGENTS.md` gate boundaries. Closure must, in the
same change: (1) update browser-use owner docs that name
`preflight-warm-chrome.ts` as "Warm Chrome runtime" — `references/warm-chrome.md`
"Owners", `SKILL.md`, `PRODUCT-BASELINE.md` — to note it now delegates to the
package; (2) on the package side, run the Doc Drift Gate
(`tests/docs-drift.test.ts` + owner-path check), retire the `CONTEXT.md` "Parity
harness" term, flip the "Browser-use switchover" term status from deferred to
closed, and move the P1 task from `TASKS.md` to `TASKS.archive.md`.

**Rationale.** The drift gates fail if these move out of sync. The "Parity
harness" term describes a file being deleted; the switchover term describes a
now-completed cutover.

**Consequences.** Larger doc footprint than the code change, but mechanical.

**Next.** Follow the `AGENTS.md` Doc Drift Gate checklist at closure.

**V2 Ideas.** None.

## Notes

- **Pre-existing doc-drift bug (NOT this switchover's fix; flag only):**
  `runtime/warm-chrome/TASKS.md:6` and `AGENTS.md:63` cite the charter at
  `docs/decisions/2026-07-03-...` relative to the package, but it actually lives
  at the **repo-root** `docs/decisions/`. The owner-path check should catch this;
  worth a separate one-line correction.
- No `CONTEXT.md` glossary edit is warranted at plan time: the "Browser-use
  switchover" term already describes exactly this cutover, and `CONTEXT.md` holds
  no implementation detail. The term's *status* flips to closed only at closure.
