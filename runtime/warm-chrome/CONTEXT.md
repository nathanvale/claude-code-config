# Warm Chrome

Browser-entry proof runtime: prove the agent is attached to the correct warm
Chrome — real headed browser, dedicated persistent profile, numeric-loopback
CDP, browser-level websocket, listener/profile/port consistency — or fail
with a canonical station, a machine-readable reason, and a repair path before
any adapter acts.

Current source map:

- Charter: `docs/decisions/2026-07-03-warm-chrome-runtime-package-definition.md`.
- Implementation plan: `docs/plans/2026-07-03-001-feat-warm-chrome-runtime-package-plan.md`.
- Runtime contract: `docs/adr/0009-browser-use-fixed-cdp-convention-and-runtime-proof.md`
  (+ 2026-07-03 amendment).
- Research capture: `skills/browser-use/docs/research/2026-07-03-warm-chrome-cdp-gotchas-and-port-policy.md`.

## Language

**Station**:
One deterministic agent-visible command outcome in the Branch Station
Catalog: station id = canonical error code = primary runtime action =
mutation pin, sixteen in total. Tests attach envelope evidence per station;
a missing or contradicting envelope is a drift finding.
_Avoid_: log line, health value, freeform status, fine-grained cause

**Proof chain**:
The single `check`-owned verification path in `src/proof.ts` every command
shares: loopback assertion, bounded attach probe, listener identity by binary
path, default-profile foreignness, payload/websocket validation, endpoint-id
cross-check, CDP round-trips, profile posture, final listener consistency.
`launch` and `repair` re-enter it rather than owning probes.
_Avoid_: per-command duplicate checks, banner trust, argv trust

**Re-emit rule**:
Proof failures reached through `launch` or `repair` re-emit the `check`-owned
station by reference — same code, same envelope, still drift-gated. The one
deliberate exception is `launch.spawned_unverified`, because a post-spawn
failure has mutated the workspace where a read-only check failure has not.
_Avoid_: duplicated stations, lifecycle-specific proof codes

**Reason detail**:
The machine-readable `data.reason` field carrying fine-grained cause under a
canonical code (for example `unsafe_profile` ← `default_profile`,
`throwaway_profile`, `unsafe_profile_permissions`, `invalid_profile_path`,
`profile_dir_remap`). The union is package-owned and closed: a new reason
lands in code first and a station test pins it before the runtime may emit
it. Agents route on the station's action, not on the reason.
_Avoid_: new error codes per cause, freeform strings, routing on reason

**Suggested explicit port**:
The informational `suggested_explicit_port` field on `port_occupied_foreign`
failures: the first loopback candidate in the bounded `9223`–`9299` window
proven free through the seam per candidate. A repair hint, never an
allocator — no spawn, no persistence, no rebinding; it becomes usable only
after an explicit rerun with `--port`/`--endpoint` and a successful proof.
_Avoid_: port allocation, durable binding, reservation

**Browser-entry exit 20**:
The package-owned exit code for a failed browser-entry proof. Every exit-20
envelope carries the `no_adapter_fallback` continuation constraint: an agent
must not switch adapters or drive a cold browser after a Warm Chrome failure.
Baseline exits stay facade-owned: `0` verified, `1` runtime failure, `2`
invalid usage.
_Avoid_: generic failure exit, retry signal, adapter-fallback permission

**Endpoint authority**:
The ok envelope is the only endpoint authority (R8): consumers take the
verified endpoint and verbatim browser-level websocket URL from it and never
derive either from the `9222` convention. `use_verified_endpoint` guidance
carries the actual endpoint — for the competing-instance guard that is the
verified convention endpoint, not the port the caller asked to spawn on.
_Avoid_: convention-derived endpoints, synthesized websocket URLs

**Mutation pin**:
The per-station declaration of cross-tool-visible state change the drift gate
checks: `check` stations are read-only, `launch.launched` and
`launch.spawned_unverified` write browser state, `repair.repaired` repairs
profile state and enumerates each mutation (`profile_dir_created`,
`profile_permissions`, `devtools_active_port`) with its exact path.
_Avoid_: undeclared side effects, implicit writes

**Race policy**:
Post-spawn, the verified listener pid decides. If it is not our own spawned
child, another Warm Chrome won the startup race: terminate only our own child
and land `already_verified`; a failed kill lands `spawned_unverified` reason
`own_child_kill_failed`. Never terminate a listener the proof did not verify
as ours to kill.
_Avoid_: kill-by-port, lock files, terminating the survivor

**Parity harness**:
`tests/parity.test.ts`: shared runtime-seam fixtures driven through both the
old authoritative preflight (`runForTest`) and this package (`main`),
comparing station, exit, and envelope outcomes. Parity is measured against a
recorded translation table; old codes with no new home are enumerated up
front as intended divergences, and the printed station-level diff is the
deferred switchover checklist input.
_Avoid_: asserted equivalence, modifying the old preflight, code-keyed mapping
