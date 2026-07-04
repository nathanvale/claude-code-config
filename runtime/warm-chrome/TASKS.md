# Warm Chrome Tasks

Hot-path project-manager dashboard.

Agent route: `AGENTS.md`. Decision lineage:
`docs/decisions/2026-07-03-warm-chrome-runtime-package-definition.md`.

## Governance

- Keep this file short enough to read before acting.
- Keep active tasks here.
- Move completed detail to `TASKS.archive.md` once it exists.
- Add at most 10 open tasks per priority group.
- Keep at most 5 Latest Signals; archive or drop older ones.
- Write tasks as verifiable slices.
- Include the next command, source owner, or decision when known.

Task shape:

```markdown
- [ ] P0/P1/P2 Title Lane: Switchover. Done when: observable command,
      test, or doc result. Next: `command`.
```

Lanes: Switchover, Proof Chain, Lifecycle, CLI Contract, Seam, Docs Language,
Verification.

## Current Priority

U1–U8 of the implementation plan closed on 2026-07-03: sixteen stations with
evidence, redaction proofs, entrypoint gate membership, and the measured
parity harness. The old preflight stays authoritative until the deferred
switchover; the parity divergence report is the checklist input.

Next safe action:

```bash
skills/test-runner/src/test-runner.sh run -- runtime/warm-chrome/tests/
```

## Now

- (empty)

## Next

- [ ] P1 browser-use switchover Lane: Switchover. Done when: `browser-use`
      routes Warm Chrome preflight through this package, the legacy
      `preflight-warm-chrome` surface is retired or wrapped, and browser-use
      docs/tests point at the `warm-chrome.browser-entry` contract. Next:
      write the switchover checklist from the parity report printed by
      `tests/parity.test.ts` (intended divergences are consumer-visible
      behavior changes: exit-2 → exit-20 rows, warm_chrome_already_running →
      ok envelope, canonical code collapse).
- [ ] P3 Race-convergence follow-up Lane: Lifecycle. Mostly resolved by the
      2026-07-03 code review: the readiness loop now treats a rival's
      transient `invalid_cdp/endpoint_id_mismatch|cdp_contention` as
      non-terminal and keeps polling within budget, so the winner converges
      inside one `launch` invocation instead of needing a separate `repair`
      (tests: launch-stations transient-recovery + persistent-mismatch). Done
      when: a calibration decision records whether the 15s budget is the right
      window for real-Chrome startup contention. Next: fold into the manual
      real-Chrome calibration run.
- [ ] P2 Platform guard decision Lane: Proof Chain. Done when: a decision
      records whether the package needs the old preflight's
      `unsupported_platform` refusal (exit 1 on non-darwin) or the seam's
      macOS-only tools fail loud enough; parity row
      `check_non_darwin_platform` measures the current gap. Next: record in
      the package decision log.
- [ ] P2 Symlink-write TOCTOU closure Lane: Seam. Done when: the repair
      DevToolsActivePort write uses an O_NOFOLLOW/tmp-rename seam primitive
      instead of lstat-then-write (narrow race noted in `src/repair.ts`).
      Also covers the sixth-pass sequencing finding: both `launch.ts`
      (post-`ensureProfileDir` `assertLaunchProfilePosture`, ~line 293) and
      `repair.ts` (post-`ensureProfileDir` `profile_not_owned`, ~line 281)
      run `ensureProfileDir` — which `mkdir`s and `chmod 0o700`s the resolved
      realpath — BEFORE the symlink-into-default re-check, so a `--profile`
      symlink into the everyday Chrome profile gets that profile chmodded to
      700 before the refusal, and the refusal envelope neither names the
      created path nor records the mutation. Next: resolve-then-verify BEFORE
      any mkdir/chmod when extending the U4 seam; seam changes are plan-gated.
- [ ] P2 Profile-predicate + DEFAULT_PROFILE_DIR duplication Lane: CLI
      Contract. Done when: the `~/.agent-warm-profile` literal and the
      default-Chrome-profile predicate each have one owner. Today `src/cli.ts`
      and `src/repair.ts` both carry the literal, and `isDefaultProfilePath`
      is copied across `src/proof.ts`, `src/launch.ts`, and `src/repair.ts`
      (three-way, flagged in `src/repair.ts`). Next: move both into
      `src/model.ts`.
- [ ] P2 Station-contract residuals decision Lane: CLI Contract. Done when: a
      recorded decision resolves the three review residuals that each change a
      Station-Map contract: (1) launch `unsafe_profile` routes `change_input`
      while the catalog's only `unsafe_profile` station says `repair_profile` —
      needs a launch-owned station or a documented re-emit exception; (2)
      `check.endpoint_unreachable` catalog action is `launch_warm_chrome` but
      the runtime override routes most reasons to `inspect_listener` —
      single-action-per-station cannot express per-reason routing; (3) the
      pre-bind refusal reuses `launch.spawned_unverified` whose trigger and
      mutation pins claim a spawn happened. Next: `record-decision` against
      the catalog drift gate.
- [ ] P3 CLI-surface minors Lane: CLI Contract. Done when: `help <typo>`
      exits 2 not 0, per-command rendered help lists the global diagnostic
      flags (`WARM_CHROME_GLOBAL_DIAGNOSTIC_FLAGS` now rides the discovery
      tree only), and the `check.non_loopback` trigger wording covers the
      `localhost_alias` reason. Next: fix in `src/cli.ts` +
      `src/branch-station-catalog.ts` with `tests/cli-surface.test.ts` pins.
- [ ] P3 Leading-zero port normalization Lane: Proof Chain. Done when:
      `--port 09222` cannot yield a spurious `non_loopback_websocket` verdict
      (URL normalizes `ws.port` to `9222` while `input.port` stays `09222`).
      Next: normalize the port in `assertPort` or compare numerically.
- [ ] P3 Sixth-pass robustness nits Lane: Proof Chain. Low-severity,
      pathological-trigger findings docketed together: (1)
      `scanSuggestedExplicitPort` (`src/proof.ts` ~1067) runs up to 77
      sequential `findListener`/`lsof` probes with no aggregate budget, so if
      `lsof` consistently hits its 3s `DEFAULT_SYSTEM_PROBE_TIMEOUT_MS` the
      `port_occupied_foreign` envelope is delayed ~4 min; (2)
      `fetchLoopbackJson` (`src/runtime.ts` ~681) accumulates the response
      body with no size cap, so an untrusted loopback listener can drive a
      large allocation within the 5s deadline before any identity check; (3)
      `readSingletonLock` (`src/runtime.ts` ~340) throws uncatalogued
      `listener_uninspectable` on any non-ENOENT `readlink` fault, so a
      SingletonLock materialized as a regular file (EINVAL) blocks launch with
      no repair path. Next: aggregate scan budget, body cap, and an EINVAL
      arm; each is in-runtime and needs a pin.
- [ ] P3 Default-profile redaction consistency Lane: CLI Contract. Sixth-pass
      findings, folds into the P2 profile-predicate duplication item: the
      relative-`--user-data-dir` rejection in `src/proof.ts` (~420) passes
      `redactListenerDetail` without `env`/`forceForeign`, and
      `redactListenerProfileDir` (`src/repair.ts` ~207) plus the
      `profile_not_owned` `profile_dir` echo (~285) only redact ABSOLUTE
      default-profile spellings — a relative spelling reaches the envelope
      verbatim. Low severity (relative paths do not carry the OS account name;
      the resolved-realpath echo is the operator's own HOME on their own
      terminal). Next: route every default-profile-path echo through one
      redactor when the predicate gets a single owner.

## Later

- [ ] P3 Browser Adapter Proof Lane: Lifecycle. Done when: the deferred
      adapter-side proof exists and forbids adapters from defaulting to the
      CDP convention after a suggested-port success (charter deferred scope;
      the sharpest recorded system risk). Next: new plan; out of package
      scope today.
- [ ] P3 WebDriver BiDi watch item Lane: Proof Chain. Done when: a dated note
      records whether CDP probe churn (Chrome 144+ hardening cadence)
      warrants a BiDi migration decision. Next: re-check the research capture
      against the then-current Chrome major.

## Latest Signals

- 2026-07-04: Sixth-pass close-out (Opus fan-out review, 10 findings, all
  verified by hand against source since the fan-out's own verifier stage died
  on a session limit). Two genuine bugs fixed + pinned: (1) HIGH TDZ crash in
  `fetchLoopbackJson` — the wall-clock deadline was armed BEFORE `request()`,
  so a synchronous `request()` throw (non-http: protocol) rejected the promise
  but left a live timer that 5s later touched `req` in its temporal dead zone,
  an uncaught ReferenceError that crashed the process (live-reproduced); fix
  arms the deadline only after `request()` returns. (2) HIGH competing-instance
  guard escape — a not-yet-existing `--profile` made the convention probe fail
  `unsafe_profile/invalid_profile_path` (profile-validity is checked before
  profile-match) instead of `listener_mismatch/profile_mismatch`, so the guard
  keyed on `listener_mismatch` fell through and spawned a SECOND Warm Chrome
  (the adapter-drift feeder it exists to block); fix re-probes the convention
  port WITHOUT the caller profile and, if a verified Warm Chrome holds it,
  re-emits the caller's profiled verdict rather than spawning. The other 8
  findings are low-severity nits or already-docketed classes (symlink
  chmod-before-refusal → P2 TOCTOU item; scan budget / body cap / EINVAL lock
  → new P3 robustness item; relative default-profile redaction → new P3
  consistency item). 254 tests green; typecheck + biome clean.
- 2026-07-04: Fifth-pass close-out: the last unverified `fetchLoopbackJson`
  branch (response stalls after headers + partial body) hid a real defect —
  under Bun the deadline's `req.destroy` flushes the buffered partial body as
  a response `end` with `complete` still false, so a truncated-but-parseable
  body RESOLVED as a healthy answer and an unparseable one rejected as
  SyntaxError instead of TimeoutError. Fixed with a `response.complete` state
  guard on the `end` handler (same state-not-timing design), pinned in
  `tests/runtime.test.ts`; `isConnectionRefusedError` also now checks the
  errno `code` before the message regex (spawn-licensing path must not rest
  on Bun's message wording). Inline review of the full working diff found no
  other issues; station-contract residuals docketed as tasks above.
- 2026-07-04: Post-audit review regressions fixed (review handoff
  `/private/tmp/warm-chrome-review-handoff/review-result.json`, 41/46 fixed,
  9 regressions): (1) CRITICAL `hasDefaultContextPage` now cross-references
  `defaultBrowserContextId` — real Chrome stamps default-context pages with
  that non-empty GUID, so the prior any-non-empty-id-is-isolated rule
  refused every healthy warm Chrome with an open tab; fixtures now model the
  real shape. (2) `classifyUnreachable` tests `isAbortError` before the
  real-listener `roundtrip_failed` fallthrough. (3) Repair's listenerless
  default profile is `expandHome`-wrapped again (literal `~` dir in cwd
  otherwise). (4) Explicitly-empty `WARM_CHROME_PROFILE_DIR` falls back to
  the dedicated default. (5) `fetchLoopbackJson` gained a hard wall-clock
  abort plus response-stream error settlement (mid-body reset no longer
  leaks a pending promise; idle `timeout` option dropped). (6) The readiness
  poll's dead-child gate defers to a live rival SingletonLock
  (`hasLiveRivalLaunch`) so the race policy can converge; dead child with no
  rival still fast-fails `spawn_failed`. (7) The competing-instance guard
  threads the caller's `--profile` into the convention probe and re-emits
  `check.listener_mismatch`/`profile_mismatch` instead of exit-0 with the
  wrong profile. Review residuals NOT fixed (design decisions, see review
  handoff): launch `unsafe_profile` `change_input` vs catalog
  `repair_profile`; `check.endpoint_unreachable` catalog action vs
  `inspect_listener` override; pre-bind refusal reusing
  `launch.spawned_unverified` trigger/mutation pins; `help <typo>` exit 0;
  diagnostic flags absent from per-command help; `non_loopback` trigger
  wording vs localhost_alias.
- 2026-07-03: Manual real-Chrome validation run recorded (switchover
  checklist input, plan Verification Contract row). Observed on macOS with
  Chrome 149.0.7827.201: (1) `check` verified a warm Chrome the legacy
  browser-use preflight had launched — cross-implementation compatibility;
  (2) `launch` against it landed `already_verified`, no spawn; (3) two
  interleaved launches on a freed port both spawned, ProcessSingleton
  retired one child, and BOTH landed `launch.spawned_unverified` reason
  `endpoint_id_mismatch` — the retired loser left a stale
  `DevToolsActivePort`, so even the surviving winner's post-spawn proof
  failed (fixture expectation "winner lands `launched`" does not hold on
  real Chrome); (4) `repair` performed exactly one mutation
  (`devtools_active_port` hygiene rewrite) and the final `check` verified
  the survivor. Readiness budget (15s) never tripped. The designed recovery
  loop (launch → spawned_unverified → repair → verified) converges.
- 2026-07-03: U8 closed: measured parity harness over shared seam fixtures
  (46 rows, station/exit/envelope), intended divergences enumerated and
  report printed for the switchover checklist; package joined the repo
  entrypoint gate and the docs-drift gate landed with `ARCHITECTURE.md`.

## Command Shortcuts

```bash
bun run runtime/warm-chrome/src/cli.ts check --json
bun run runtime/warm-chrome/src/cli.ts status
skills/test-runner/src/test-runner.sh run -- runtime/warm-chrome/tests/
bun run command-entrypoint:integration
bun --filter @side-quest/warm-chrome typecheck
```
