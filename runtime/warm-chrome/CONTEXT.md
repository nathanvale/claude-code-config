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

Each term includes `_Developer example_` for preferred maintainer phrasing and
`_Avoid example_` for common near-miss phrasing.

**Maintainer route**:
The package-local routing surface in `AGENTS.md`: intent gate, source owners,
change recipes, doc drift gate, debug path, safety invariants, and verification
commands. It points to owner files; it does not restate command schemas.
_Avoid_: README duplicate, hidden checklist, source-owner copy
_Developer example_: "For a station change, follow the maintainer route:
`AGENTS.md` -> station owner files -> package verification."
_Avoid example_: "Copy the command contract into README so agents have the
schema nearby."

**Task dashboard**:
The active work list in `TASKS.md`. It stays short, uses verifiable slices, and
moves closed rationale to `TASKS.archive.md` when a task closes or a latest
signal becomes historical.
_Avoid_: review transcript, plan archive, source of contract truth
_Developer example_: "Add the platform guard as a P2 task with a done check
and next command."
_Avoid example_: "Paste the whole review handoff into `TASKS.md` so nothing is
lost."

**Doc drift gate**:
The maintainer-doc check surface: `tests/docs-drift.test.ts` proves the
`ARCHITECTURE.md` Module Map matches `src/`, and the owner-path checker proves
backticked repo-local paths exist. It runs after source-owner moves, CLI
contract changes, station changes, output changes, or task-status closure.
_Avoid_: prose promise, manual memory, generated docs
_Developer example_: "After moving proof helpers, run the doc drift gate and
owner-path check."
_Avoid example_: "The docs look right by inspection, so skip the drift test."

**Browser-use switchover**:
The closed cutover where `skills/browser-use` stopped using its legacy
`preflight-warm-chrome` implementation and now routes through this package's
`warm-chrome.browser-entry` contract. The front door
(`skills/browser-use/src/preflight-warm-chrome.ts`) is a thin delegator to this
package's `main()`; the adapter router gates on `data.contract_id`; the Browser
Adapter Proof composes the package proof in-process. The legacy implementation
and the parity harness are deleted.
_Avoid_: deferred, old preflight authoritative, parity checklist input
_Developer example_: "browser-use's Warm Chrome front door delegates to the
package; edit proof behavior in `runtime/warm-chrome`, not browser-use."
_Avoid example_: "Edit `skills/browser-use/src/preflight-warm-chrome.ts` to
change proof behavior — it only delegates now."

**Station**:
One deterministic agent-visible command outcome in the Branch Station
Catalog: station id = canonical error code = primary runtime action =
mutation pin, sixteen in total. Tests attach envelope evidence per station;
a missing or contradicting envelope is a drift finding.
_Avoid_: log line, health value, freeform status, fine-grained cause
_Developer example_: "`check.port_occupied_foreign` stays one station even when
the reason is `foreign_listener` or `json_answers_on_default_profile`."
_Avoid example_: "Add a new station for every listener failure string."

**Proof chain**:
The single `check`-owned verification path in `src/proof.ts` every command
shares: loopback assertion, bounded attach probe, listener identity by binary
path, default-profile foreignness, payload/websocket validation, endpoint-id
cross-check, CDP round-trips, profile posture, final listener consistency.
`launch` and `repair` re-enter it rather than owning probes.
_Avoid_: per-command duplicate checks, banner trust, argv trust
_Developer example_: "Launch should call the proof chain after spawn instead
of reimplementing listener identity checks."
_Avoid example_: "Repair can trust the Chrome argv because it already found a
matching port."

**Re-emit rule**:
Proof failures reached through `launch` or `repair` re-emit the `check`-owned
station by reference — same code, same envelope, still drift-gated. The one
deliberate exception is `launch.spawned_unverified`, because a post-spawn
failure has mutated the workspace where a read-only check failure has not.
_Avoid_: duplicated stations, lifecycle-specific proof codes
_Developer example_: "A launch-time `unsafe_profile` proof failure re-emits the
check-owned station unless the spawn already wrote browser state."
_Avoid example_: "Create `launch.unsafe_profile` just because the failure was
seen during launch."

**Reason detail**:
The machine-readable `data.reason` field carrying fine-grained cause under a
canonical code (for example `unsafe_profile` ← `default_profile`,
`throwaway_profile`, `unsafe_profile_permissions`, `invalid_profile_path`,
`profile_dir_remap`). The union is package-owned and closed: a new reason
lands in code first and a station test pins it before the runtime may emit
it. Agents route on the station's action, not on the reason.
_Avoid_: new error codes per cause, freeform strings, routing on reason
_Developer example_: "Add `profile_dir_remap` to the closed reason union and
pin a station fixture before emitting it."
_Avoid example_: "Route `invalid_profile_path` to a different action than the
station action."

**Suggested explicit port**:
The informational `suggested_explicit_port` field on `port_occupied_foreign`
failures: the first loopback candidate in the bounded `9223`–`9299` window
proven free through the seam per candidate. A repair hint, never an
allocator — no spawn, no persistence, no rebinding; it becomes usable only
after an explicit rerun with `--port`/`--endpoint` and a successful proof.
_Avoid_: port allocation, durable binding, reservation
_Developer example_: "Show `suggested_explicit_port` as rerun guidance, then
require the rerun proof to authorize the endpoint."
_Avoid example_: "Persist the suggested port and teach consumers to attach to
it immediately."

**Browser-entry exit 20**:
The package-owned exit code for a failed browser-entry proof. Every exit-20
envelope carries the `no_adapter_fallback` continuation constraint: an agent
must not switch adapters or drive a cold browser after a Warm Chrome failure.
Baseline exits stay facade-owned: `0` verified, `1` runtime failure, `2`
invalid usage.
_Avoid_: generic failure exit, retry signal, adapter-fallback permission
_Developer example_: "Exit 20 means browser-entry failed and adapter fallback
is closed."
_Avoid example_: "Exit 20 is just another retryable CLI failure."

**Endpoint authority**:
The ok envelope is the only endpoint authority (R8): consumers take the
verified endpoint and verbatim browser-level websocket URL from it and never
derive either from the `9222` convention. `use_verified_endpoint` guidance
carries the actual endpoint — for the competing-instance guard that is the
verified convention endpoint, not the port the caller asked to spawn on.
_Avoid_: convention-derived endpoints, synthesized websocket URLs
_Developer example_: "Pass the endpoint from the ok envelope to the adapter."
_Avoid example_: "The command passed `--port 9250`, so synthesize
`http://127.0.0.1:9250` after a successful check."

**CLI input fallback**:
Flags win over environment. `WARM_CHROME_CDP_PORT` supplies the default port,
`WARM_CHROME_PROFILE_DIR` supplies the default profile input,
`WARM_CHROME_RUN_ID` supplies diagnostics correlation, and `CHROME_BIN` supplies
the launch binary input. `--endpoint` accepts only numeric loopback
`http://127.0.0.1:<port>`; `localhost` is intentionally rejected by proof.
_Avoid_: hidden env behavior, hostname alias trust, proxy-derived endpoints
_Developer example_: "`--endpoint http://127.0.0.1:9222` overrides
`WARM_CHROME_CDP_PORT`."
_Avoid example_: "Accept `localhost` because it resolves to loopback on this
machine."

**Mutation pin**:
The per-station declaration of cross-tool-visible state change the drift gate
checks: `check` stations are read-only, `launch.launched` and
`launch.spawned_unverified` write browser state, `repair.repaired` repairs
profile state and enumerates each mutation (`profile_dir_created`,
`profile_permissions`, `devtools_active_port`) with its exact path.
_Avoid_: undeclared side effects, implicit writes
_Developer example_: "`repair.repaired` names the exact profile mutations in
the envelope."
_Avoid example_: "Repair chmods the profile as an implementation detail not
visible to the station contract."

**Race policy**:
Post-spawn, the verified listener pid decides. If it is not our own spawned
child, another Warm Chrome won the startup race: terminate only our own child
and land `already_verified`; a failed kill lands `spawned_unverified` reason
`own_child_kill_failed`. Never terminate a listener the proof did not verify
as ours to kill.
_Avoid_: kill-by-port, lock files, terminating the survivor
_Developer example_: "If another verified listener wins, kill only the child
spawned by this launch invocation."
_Avoid example_: "Kill whatever process owns the requested port."
