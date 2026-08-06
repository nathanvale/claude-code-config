# Warm Chrome Tasks Archive

Closed detail and long review rationale for `runtime/warm-chrome/TASKS.md`.
Keep active choices in `TASKS.md`; use this file when history matters.

## Closed Implementation Units

- 2026-07-03 U1 package scaffold closed: `@side-quest/warm-chrome` lives at
  `runtime/warm-chrome`, source-linked bin `warm-chrome`, facade dependency,
  tests, typecheck, and package docs.
- 2026-07-03 U2 command contract closed: `check`, `status`, `launch`,
  `repair`, exit `20`, action affordances, write-preview posture, discovery,
  and help surface pinned.
- 2026-07-03 U3 Branch Station Catalog closed: sixteen stations, re-emit map,
  canonical code/action/mutation pins, and station evidence manifest.
- 2026-07-03 U4 runtime seam and redaction gate closed: injectable runtime,
  source entrypoint, envelope plumbing, foreign-listener redaction, and
  process-boundary entrypoint tests.
- 2026-07-03 U5 check proof closed: proof chain, reason details, suggested
  explicit port, endpoint authority, and cold-agent envelopes pinned.
- 2026-07-03 U6 launch lifecycle closed: no-spawn guards, competing-instance
  guard, readiness polling, race policy, and post-spawn mutation station.
- 2026-07-03 U7 repair lifecycle closed: profile repair, unrepairable
  refusal, foreign-listener refusal, and symlink guard tests.
- 2026-07-03 U8 parity/docs closed: measured old/new parity harness,
  entrypoint gate membership, docs-drift gate, and architecture map.

## Archived Signals

### 2026-07-04 Sixth-Pass Closeout

Opus fan-out review produced ten findings; hand verification was needed because
the fan-out verifier stage ended on a session limit.

Fixed and pinned:

- HIGH `fetchLoopbackJson` TDZ crash: the wall-clock deadline armed before
  `request()`, so a synchronous `request()` throw left a live timer that later
  touched `req` in its temporal dead zone. Fix: arm the deadline after
  `request()` returns.
- HIGH competing-instance guard escape: a not-yet-existing `--profile` made
  the convention probe fail `unsafe_profile/invalid_profile_path` before
  profile-match classification, so the guard fell through and spawned a second
  Warm Chrome. Fix: re-probe the convention port without caller profile and
  re-emit the caller's profiled verdict when verified Warm Chrome holds it.

Residuals moved to active tasks:

- Symlink chmod-before-refusal -> P2 Symlink-write TOCTOU closure.
- Scan budget, body cap, EINVAL lock -> P3 Sixth-pass robustness nits.
- Relative default-profile redaction -> P3 Default-profile redaction
  consistency.

Verification at closeout: 254 tests green; typecheck and Biome clean.

### 2026-07-04 Fifth-Pass Closeout

The last unverified `fetchLoopbackJson` branch hid a real defect. Under Bun,
deadline `req.destroy` can flush buffered partial response data as `end` while
`response.complete` remains false. A truncated-but-parseable body resolved as a
healthy answer, and an unparseable one rejected as `SyntaxError` instead of
`TimeoutError`.

Fix: guard the `end` handler with `response.complete`. Also tighten
`isConnectionRefusedError` to check errno `code` before message regex.

Station-contract residuals were docketed as active tasks.

### 2026-07-04 Post-Audit Regression Fixes

Review handoff:
`/private/tmp/warm-chrome-review-handoff/review-result.json`.

Fixed regressions:

- `hasDefaultContextPage` now cross-references `defaultBrowserContextId`.
  Real Chrome stamps default-context pages with a non-empty GUID; the prior
  any-non-empty-id-is-isolated rule refused healthy Warm Chrome with an open
  tab.
- `classifyUnreachable` tests `isAbortError` before the real-listener
  `roundtrip_failed` fallthrough.
- Repair's listenerless default profile is `expandHome`-wrapped again.
- Explicitly-empty `WARM_CHROME_PROFILE_DIR` falls back to the dedicated
  default.
- `fetchLoopbackJson` gained hard wall-clock abort and response-stream error
  settlement.
- The readiness poll's dead-child gate defers to a live rival SingletonLock.
- The competing-instance guard threads caller `--profile` into the convention
  probe and re-emits `check.listener_mismatch` / `profile_mismatch` instead of
  exit 0 with the wrong profile.

Residual design decisions became active tasks:

- Launch `unsafe_profile` action mismatch.
- `check.endpoint_unreachable` catalog action vs runtime override.
- Pre-bind refusal reusing `launch.spawned_unverified`.
- `help <typo>` exit behavior.
- Diagnostic flags absent from per-command help.
- `non_loopback` trigger wording for `localhost_alias`.

### 2026-07-03 Manual Real-Chrome Validation

Observed on macOS with Chrome 149.0.7827.201:

- `check` verified Warm Chrome launched by legacy browser-use preflight.
- `launch` against that browser landed `already_verified`, no spawn.
- Two interleaved launches on a freed port both spawned; ProcessSingleton
  retired one child; both landed `launch.spawned_unverified` reason
  `endpoint_id_mismatch` because stale `DevToolsActivePort` remained.
- `repair` performed one `devtools_active_port` hygiene rewrite, then final
  `check` verified the survivor.

Readiness budget did not trip. Designed recovery loop:
`launch` -> `spawned_unverified` -> `repair` -> `verified`.

### 2026-07-03 U8 Closure

Measured parity harness covers 46 shared seam fixture rows across station,
exit, and envelope outcomes. Intended divergences are enumerated and printed
for the browser-use switchover checklist. Package joined the repo entrypoint
gate; `ARCHITECTURE.md` docs-drift gate landed.

### 2026-07-04 Browser-Use Switchover Closed (P1)

Plan: `docs/plans/2026-07-04-001-feat-browser-use-warm-chrome-switchover-plan.md`.
Decision log:
`docs/decisions/2026-07-04-001-browser-use-warm-chrome-switchover-decision-log.md`.

browser-use now routes its production Warm Chrome proof through this package:

- `skills/browser-use/src/preflight-warm-chrome.ts` is a thin delegator to
  `main()` with a `WARM_CHROME_X ?? BROWSER_USE_X` env bridge (CDP_PORT,
  PROFILE_DIR, RUN_ID); the `preflight-warm-chrome` bin, dist entrypoint, and
  argv contract are unchanged.
- `skills/browser-use/src/browser-adapter-router-prepare.ts` gates the Warm
  Chrome proof on the package's `data.contract_id == WARM_CHROME_CONTRACT_ID`
  (a `contractField` param keeps the shared parser serving the adapter proof's
  `data.contract`). The legacy `WARM_CHROME_PREFLIGHT_CONTRACT_ID` + preflight
  contract surface (`warmChromePreflightContracts`) are removed.
- `skills/browser-use/src/preflight-browser-adapter.ts` composes the package
  proof in-process via `main(..., { handlers: { check: createCheckCommandHandler(proofDeps) } })`.
  This was not enumerated in the plan units: the live adapter proof imported the
  old implementation's runtime helpers, so R2's deletion forced the repoint. It
  is behavior-preserving — the adapter proof reads only `action`/`endpoint`/`port`
  from the inner envelope and gates on `exitCode !== 0` — but the adapter proof
  now enforces the package's stronger CDP-attach proof and its exit-20 taxonomy
  (its one composition-failure test moved from the old `endpoint_unreachable` /
  `enable_remote_debugging` vocab to the package's `launch_warm_chrome`).

Deleted with the cutover: the ~2030-line legacy implementation body, the parity
harness `tests/parity.test.ts` (its 5 uniquely-covered `new`-side behaviors were
already pinned by the `launch-stations`/`repair-stations` suites, so no coverage
was lost), and browser-use's 3356-line preflight-warm-chrome test file that
tested the deleted implementation. KTD6 confirmed empirically: `bun run
src/build-dist.ts` passes and the built `dist/preflight-warm-chrome.js` carries 0
`@side-quest` specifiers with the proof symbols inlined.

## Archived Task Rationale

### Symlink And Profile Mutation Ordering

The P2 Symlink-write TOCTOU item also covers a sixth-pass sequencing finding:
`src/launch.ts` post-`ensureProfileDir` `assertLaunchProfilePosture` and
`src/repair.ts` post-`ensureProfileDir` `profile_not_owned` call
`ensureProfileDir` before the symlink-into-default re-check. Since
`ensureProfileDir` can mkdir and chmod `0o700` the resolved realpath, a
`--profile` symlink into the everyday Chrome profile can mutate that profile
before refusal. Future seam work should resolve and verify before mkdir/chmod.

### Race-Convergence Follow-Up

Mostly resolved by the 2026-07-03 code review: the readiness loop treats a
rival's transient `invalid_cdp/endpoint_id_mismatch` or `cdp_contention` as
non-terminal and keeps polling within budget. The remaining task is a
calibration decision on whether 15 seconds is the right real-Chrome startup
contention window.
