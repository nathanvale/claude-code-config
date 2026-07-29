# Warm Chrome Tasks

Hot-path project-manager dashboard.

Agent route: `AGENTS.md`. Decision lineage:
`docs/decisions/2026-07-03-warm-chrome-runtime-package-definition.md`.
Archive: `TASKS.archive.md`.

## Governance

- Keep this file short enough to read before acting.
- Keep active tasks here.
- Move completed detail to `TASKS.archive.md` in the same pass that closes it.
- Add at most 10 open tasks per priority group.
- Keep at most 5 Latest Signals; archive or drop older ones.
- Write tasks as verifiable slices.
- Include the next command, source owner, or decision when known.
- Leave historical plan docs unchanged unless archive wording misleads current
  agents.

Task shape:

```markdown
- [ ] P0/P1/P2 Title Lane: Switchover. Done when: observable command,
      test, or doc result. Next: `command`.
```

Lanes: Switchover, Proof Chain, Lifecycle, CLI Contract, Seam, Docs Language,
Verification.

## Current Priority

Implementation U1-U8 closed on 2026-07-03. Nineteen stations, redaction proofs,
entrypoint gate membership, and docs-drift are live. The browser-use switchover
closed on 2026-07-04 and the interim delegator retired on 2026-07-16 (migration
cleanup U5/KTD6): browser entry reaches this package only through
`runtime/browser-connect` in-process, and browser-use consumes the Verified
Handoff Envelope. This package is now the single owner of the production Warm
Chrome proof path. Retired-path detail: `TASKS.archive.md` + Latest Signals.

Next safe action:

```bash
skills/test-runner/src/test-runner.sh run -- runtime/warm-chrome/tests/
```

## Now

No active P0/P1 work.

## Next

- [ ] P2 Platform guard decision Lane: Proof Chain. Done when: a decision
      records whether the package needs the old preflight's
      `unsupported_platform` refusal (exit 1 on non-darwin) or the seam's
      macOS-only tools fail loud enough. The parity row that measured this gap
      (`check_non_darwin_platform`) is gone with the harness; re-establish the
      gap with a station test if the decision keeps the guard. Next: record in
      the package decision log.
- [ ] P2 Symlink-write TOCTOU closure Lane: Seam. Done when: the repair
      DevToolsActivePort write uses an O_NOFOLLOW/tmp-rename seam primitive
      and profile realpath verification happens before mkdir/chmod. Next:
      resolve-then-verify before extending the U4 seam.
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
      while the catalog's only `unsafe_profile` station says `repair_profile` -
      needs a launch-owned station or a documented re-emit exception; (2)
      `check.endpoint_unreachable` catalog action is `launch_warm_chrome`, but
      the runtime override routes most reasons to `inspect_listener` -
      single-action-per-station cannot express per-reason routing; (3) the
      pre-bind refusal reuses `launch.spawned_unverified` whose trigger and
      mutation pins claim a spawn happened. Next: `record-decision` against
      the catalog drift gate.
- [ ] P3 Race-convergence follow-up Lane: Lifecycle. Done when: a calibration
      decision records whether the 15s launch readiness budget is the right
      window for real-Chrome startup contention. Next: fold into the manual
      real-Chrome calibration run.
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
- [ ] P3 Default-profile redaction consistency Lane: CLI Contract. Partly
      closed by the CodeRabbit round (env-less `redactListenerDetail` now
      guards unconditionally via the HOME-absent fallback, pinned in
      `tests/redaction.test.ts`). Remaining, folds into the P2
      profile-predicate duplication item: `redactListenerProfileDir`
      (`src/repair.ts` ~207) and the `profile_not_owned` `profile_dir` echo
      (~285) only redact ABSOLUTE default-profile spellings; a relative
      spelling reaches the envelope verbatim. Low severity (relative paths do
      not carry the OS account name; the resolved-realpath echo is the
      operator's own HOME on their own terminal). Next: route every
      default-profile-path echo through one redactor when the predicate gets a
      single owner.

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

- 2026-07-16: browser-use delegator retired (migration cleanup U5/KTD6).
  `skills/browser-use/src/preflight-warm-chrome.ts` + test + bin deleted; the
  only consumer path is now `runtime/browser-connect` in-process. The
  delegator's `BROWSER_USE_*` -> `WARM_CHROME_*` env bridge retired with it.
- 2026-07-04: browser-use switchover closed (P1 done). Front door delegates to
  `main()`; adapter router gates on `data.contract_id`; adapter proof composes
  the package proof in-process; legacy `preflight-warm-chrome` impl + parity
  harness deleted. Detail: `TASKS.archive.md`.
- 2026-07-04: Sixth-pass fixes closed two high bugs: `fetchLoopbackJson` TDZ
  deadline crash and competing-instance guard escape. Residual nits moved into
  P2/P3 tasks. Detail: `TASKS.archive.md`.
- 2026-07-04: Fifth-pass `fetchLoopbackJson` partial-body branch fixed and
  pinned; station-contract residuals docketed. Detail: `TASKS.archive.md`.
- 2026-07-04: Post-audit regressions fixed from review handoff; design
  residuals became active CLI Contract tasks. Detail: `TASKS.archive.md`.
- 2026-07-03: Manual real-Chrome validation recorded cross-implementation
  compatibility and launch/repair convergence behavior. Detail:
  `TASKS.archive.md`.

## Command Shortcuts

```bash
bun run runtime/warm-chrome/src/cli.ts check --json
bun run runtime/warm-chrome/src/cli.ts status
skills/test-runner/src/test-runner.sh run -- runtime/warm-chrome/tests/
bun run command-entrypoint:integration
bun --filter @side-quest/warm-chrome typecheck
```
