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
- [ ] P2 Race-converges-via-repair calibration Lane: Lifecycle. Done when: a
      decision records whether the interleaved-launch outcome observed on
      2026-07-03 (both racers land `spawned_unverified` reason
      `endpoint_id_mismatch`; recovery is `repair` → `check.verified`) should
      instead converge inside one `launch` invocation (e.g. re-read
      `DevToolsActivePort` after the survivor settles). See the validation
      record in Latest Signals. Next: record in the package decision log
      alongside the platform-guard decision.
- [ ] P2 Platform guard decision Lane: Proof Chain. Done when: a decision
      records whether the package needs the old preflight's
      `unsupported_platform` refusal (exit 1 on non-darwin) or the seam's
      macOS-only tools fail loud enough; parity row
      `check_non_darwin_platform` measures the current gap. Next: record in
      the package decision log.
- [ ] P2 Symlink-write TOCTOU closure Lane: Seam. Done when: the repair
      DevToolsActivePort write uses an O_NOFOLLOW/tmp-rename seam primitive
      instead of lstat-then-write (narrow race noted in `src/repair.ts`).
      Next: extend the U4 seam deliberately; seam changes are plan-gated.
- [ ] P2 DEFAULT_PROFILE_DIR duplication Lane: CLI Contract. Done when: the
      `~/.agent-warm-profile` literal has one owner (`src/cli.ts` and
      `src/repair.ts` both carry it today, flagged in `src/repair.ts`).
      Next: move the constant into `src/model.ts`.

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
- 2026-07-03: U6/U7 closed: launch lifecycle (pre-spawn short-circuit,
  competing-instance guard, SingletonLock pre-bind refusal, readiness budget,
  own-child race policy) and repair lifecycle (R11 refusal stance, ownership
  gate, diagnosed DevToolsActivePort hygiene, never-follow-symlink guard).
- 2026-07-03: U5 closed: the full check proof chain with the research reject
  rules (headless UA, isolated context, default-profile foreignness,
  endpoint-id cross-check, cdp_contention re-probe, suggested explicit port).
- 2026-07-03: U1–U4 closed: package scaffold, command contract, the
  sixteen-station catalog with drift gate and evidence manifest, and the
  facade-backed chassis with R13 redaction chokepoints.

## Command Shortcuts

```bash
bun run runtime/warm-chrome/src/cli.ts check --json
bun run runtime/warm-chrome/src/cli.ts status
skills/test-runner/src/test-runner.sh run -- runtime/warm-chrome/tests/
bun run command-entrypoint:integration
bun --filter @side-quest/warm-chrome typecheck
```
