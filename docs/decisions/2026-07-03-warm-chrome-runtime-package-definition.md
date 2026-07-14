---
title: Warm Chrome Runtime Package Definition Decision Log
slug: warm-chrome-runtime-package-definition
type: decision-log
status: accepted
date: "2026-07-03"
timezone: Australia/Melbourne
owner: runtime/warm-chrome
source:
  - skills/browser-use/docs/research/2026-07-03-warm-chrome-cdp-gotchas-and-port-policy.md
  - skills/browser-use/src/preflight-warm-chrome.ts
  - skills/browser-use/src/command-contract.ts
  - runtime/agent-skills/src/branch-station-catalog.ts
  - docs/adr/0009-browser-use-fixed-cdp-convention-and-runtime-proof.md
decision_metadata_format: fenced-yaml-per-decision
---

# Warm Chrome Runtime Package Definition Decision Log

Product-definition grill for the first hardened package boundary under
`browser-use`: the Warm Chrome Runtime Package. Decisions 1-4 accepted by
Nathan one at a time; 5-16 accepted as a batch of Strong Pick recommendations
("answer the next 20 strong recommendations").

## Context

`browser-use` stays the agent-facing product. Warm Chrome becomes an
independently hardened browser-entry package that owns readiness proof: real
Chrome, dedicated persistent profile, loopback CDP, browser-level websocket,
listener/profile/port consistency — fail with a repair path before any adapter
acts. Research capture: `skills/browser-use/docs/research/2026-07-03-warm-chrome-cdp-gotchas-and-port-policy.md`.

## Decisions

```yaml
id: package-name-and-placement
status: accepted
accepted_by: nathan
```

Package lives at `runtime/warm-chrome`, npm name `@side-quest/warm-chrome`.
Matches glossary term Warm Chrome Runtime Package; sits beside the Branch
Station Catalog precedent (`runtime/agent-skills`). Rejected
`runners/warm-chrome-runner`: second name for one concept, "runner" collides
with Agent Runner / MCP runner vocabulary, `runners/` holds diagnostics tools
not contract packages.

```yaml
id: first-catalog-scope-full-lifecycle
status: accepted
accepted_by: nathan
```

First Branch Station Catalog covers the full Warm Chrome lifecycle: `check`,
`status`, `launch`, `repair`, success proof, occupied-9222 with suggested
explicit port, wrong browser, unsafe profile, non-loopback, invalid CDP,
listener mismatch, invalid usage. Deferred: Browser Adapter Proof, Router,
action operations, multi-engine oracle.

```yaml
id: catalog-first-tdd-port
status: accepted
accepted_by: nathan
```

Implementation order: full catalog of branches and stations first, then tests
per station, then port proven proof internals from
`skills/browser-use/src/preflight-warm-chrome.ts` station-by-station.
Old file stays authoritative until parity; `browser-use` switches to the
package after parity. Rejected lift-and-shift (catalog retrofitted, not
driving) and thin wrapper (hollow boundary).

```yaml
id: proof-failures-catalogued-under-check
status: accepted
accepted_by: nathan
```

Proof-failure stations live under `check` only. The proof is one shared code
path; per-command duplicate stations would pin one envelope four times.
Explicit catalog rule: `launch` and `repair` re-emit `check` proof-failure
stations by reference, so a diverging envelope is still a drift finding.

```yaml
id: status-is-presentation-alias
status: accepted
evidence: skills/browser-use/src/preflight-warm-chrome.ts:395
```

`status` is a plain-output presentation alias of `check` (matches existing
implementation). No stations of its own; it renders `check` stations.

```yaml
id: canonical-intent-level-error-codes
status: accepted
```

One station = one canonical error code = one primary repair action.
Fine-grained cause (for example `default_profile`, `throwaway_profile`,
`unsafe_profile_permissions` under `unsafe_profile`) moves to a
machine-readable `reason` detail. Agents route on action, not cause; code =
station keeps the drift gate 1:1.

```yaml
id: port-occupied-foreign-vocabulary
status: accepted
```

New error code `port_occupied_foreign`: convention port `9222` occupied by a
non-Warm-Chrome listener. Failure payload carries informational
`suggested_explicit_port` (first free loopback candidate from a runtime scan).
New runtime action id `rerun_with_explicit_port`; no executable command
template (facade rule). Suggestion is a repair hint, never an allocator: no
spawn, no persistence, no rebinding. A suggested port becomes usable only
after explicit rerun with `--port`/`--endpoint` and a successful proof.

```yaml
id: exit-semantics
status: accepted
```

Baseline Exit Semantics `0`/`1`/`2` plus package-owned `20` browser-entry
failure (carried over from preflight-warm-chrome). `20` earns its place:
agents route Browser Entry Handoff vs runtime failure without parsing codes.

```yaml
id: first-branch-station-catalog
status: accepted
```

Sixteen stations: fifteen as originally accepted, plus
`launch.spawned_unverified` added to the table on 2026-07-03 by the
post-review amendment below. Proof failures exit `20` (browser entry),
envelope `error`, mutation `read_only` unless noted.

| station id | exit | envelope | error code | primary action |
| --- | --- | --- | --- | --- |
| `check.verified` | 0 | ok | — | `use_verified_endpoint` |
| `check.port_occupied_foreign` | 20 | error | `port_occupied_foreign` | `rerun_with_explicit_port` |
| `check.endpoint_unreachable` | 20 | error | `endpoint_unreachable` | `launch_warm_chrome` |
| `check.wrong_browser` | 20 | error | `wrong_browser` | `launch_warm_chrome` |
| `check.unsafe_profile` | 20 | error | `unsafe_profile` | `repair_profile` |
| `check.non_loopback` | 20 | error | `non_loopback` | `change_input` |
| `check.invalid_cdp` | 20 | error | `invalid_cdp` | `inspect_listener` |
| `check.listener_mismatch` | 20 | error | `listener_mismatch` | `inspect_listener` |
| `check.runtime_failure` | 1 | error | `runtime_failure` | `inspect_diagnostics` |
| `check.invalid_usage` | 2 | error | `invalid_usage` | — |
| `launch.launched` | 0 | ok | — | `use_verified_endpoint` |
| `launch.already_verified` | 0 | ok | — | `use_verified_endpoint` |
| `launch.port_occupied_foreign` | 20 | error | `port_occupied_foreign` | `rerun_with_explicit_port` |
| `launch.spawned_unverified` | 20 | error | `spawned_unverified` | `inspect_diagnostics` |
| `repair.repaired` | 0 | ok | — | `use_verified_endpoint` |
| `repair.unrepairable` | 20 | error | `unrepairable` | `inspect_diagnostics` |

Dated note 2026-07-03 on the sixteenth row: `launch.spawned_unverified`
exists because a post-spawn proof failure has mutated the workspace where a
read-only `check` failure has not, and the 1:1 station = code = mutation-pin
drift gate cannot express that difference through the re-emit rule (full
rationale in the post-plan-review amendment below).

Reason details (non-exhaustive): `wrong_browser` ← `chrome_for_testing`;
`unsafe_profile` ← `default_profile`, `throwaway_profile`,
`unsafe_profile_permissions`, `invalid_profile_path`; `non_loopback` ←
`non_loopback_endpoint`, `non_loopback_websocket`; `listener_mismatch` ←
`port_mismatch`, `profile_mismatch`, `listener_missing`.

Mutation pins: `launch.launched` `writes_browser_state`;
`launch.already_verified` `no_spawn`; `launch.port_occupied_foreign`
`fails_closed_without_spawn` (research test requirement: prove no spawn when the
requested CDP port is held by a foreign listener); `launch.spawned_unverified`
`writes_browser_state`; `repair.repaired` `repairs_profile_state`;
`repair.unrepairable` `fails_closed`.

**Amendment 2026-07-03 (post-plan review): sixteenth station.** Multi-lens plan
review (feasibility + adversarial, confidence 100) showed the drift gate cannot
express "same error code, different mutation class" through the re-emit rule: a
`check.unsafe_profile` reached *after* a spawn has mutated the workspace where a
read-only `check` failure has not. Added `launch.spawned_unverified` (exit 20,
error, code `spawned_unverified`, primary action `inspect_diagnostics`, mutation
pin `writes_browser_state`) for post-spawn proof failure, readiness-budget
exhaustion, and failed own-child kill. The catalog is now sixteen stations. A
post-spawn failure whose reason is a check-failure reason carries that check
station's primary action as a secondary `runtime_actions` entry so the agent
does not lose a known-good repair action.

**Amendment 2026-07-03: research-surfaced reason vocabulary.** A CDP-attach
gotcha sweep across other tools (Playwright CLI/connectOverCDP, Cypress, the
first-party Chrome DevTools CLI, chrome-devtools-mcp, Stagehand, Skyvern, Nova
Act, Selenium/BiDi, chrome-remote-interface) added reject rules that live as
reason details, not new stations: `wrong_browser` ← `headless_not_headed`
(headless-new is endpoint-indistinguishable; the only tell is `HeadlessChrome`
in the `Browser.getVersion` UA), `chromium`, `electron_or_other`,
`isolated_context`; `port_occupied_foreign` ← `json_answers_on_default_profile`
(on Chrome 144+/147/150 a `/json/version` that answers on the default profile is
a foreign instance), `listener_uninspectable`; `invalid_cdp` ← `ws_only_no_http`,
`endpoint_id_mismatch`, `cdp_contention`, `roundtrip_failed`; `endpoint_unreachable`
← `pipe_only_no_tcp`, `attach_timeout`; `unsafe_profile` ← `profile_dir_remap`;
`non_loopback` ← `localhost_alias`; `spawned_unverified` ← `own_child_kill_failed`.
Full provenance in the research capture and the implementation plan
`docs/plans/2026-07-03-001-feat-warm-chrome-runtime-package-plan.md`.

**Amendment 2026-07-14: fixed-port hint correction (#232).** Chrome writes
`DevToolsActivePort` when an ephemeral port (`--remote-debugging-port=0`) needs
bootstrap discovery; it does not refresh the file for Warm Chrome's fixed-port
launch. A persisted endpoint id can therefore describe an older browser while
the live listener, `/json/version`, browser websocket, CDP round-trips, and
profile all verify. Retire `endpoint_id_mismatch` from the check reason union.
Treat the file as ADR 0009 specifies: optional adapter hint material that
`repair` may reconcile after live proof, never browser-entry identity.

**Amendment 2026-07-03 (implementation closure): reason unions as landed in
code.** The TDD port (U5–U7) finalized the seeded vocabulary with additions
this log had not yet recorded: `endpoint_unreachable` ← `no_listener`;
`invalid_cdp` ← `malformed_json_version`; `port_occupied_foreign` ←
`foreign_listener`; `listener_mismatch` ← `pid_mismatch` (the untrusted-input
cross-check when `/json/version` reports a pid disagreeing with the observed
listener, and the final-consistency re-check); `spawned_unverified` ←
`readiness_timeout`, `prior_launch_mid_startup` (SingletonLock pre-bind
refusal) — launch additionally passes any check reason through unchanged on a
post-spawn proof failure; `wrong_browser` ← `launch_binary_not_real_chrome`
(launch-owned); and the repair-owned `unrepairable` union ←
`foreign_listener_on_port`, `profile_not_owned`, `profile_dir_uncreatable`,
`devtools_active_port_symlink`. Owners:
`runtime/warm-chrome/src/model.ts` (check union),
`runtime/warm-chrome/src/launch.ts` (launch-local reasons),
`runtime/warm-chrome/src/repair.ts` (repair reasons); each reason is pinned
by a station test before the runtime may emit it.

```yaml
id: package-owned-contract-id
status: accepted
```

Package owns a new result contract id and schema version. `browser-use` keeps
its legacy `WARM_CHROME_PREFLIGHT_CONTRACT_ID` until the parity switch.

```yaml
id: adr-0009-amendment-not-supersede
status: accepted
```

Suggested-port policy fits ADR 0009's decision (port stays a current-run
input; no durable binding; no allocator). Amend ADR 0009 with a dated
addendum rather than superseding it or writing a new ADR.

```yaml
id: no-implementation-this-session
status: accepted
```

Session output is definition artifacts only: this log, the ADR 0009
amendment, and the Suggested Explicit Port glossary term. Next step: scaffold
`runtime/warm-chrome`, write failing station tests, port station-by-station.

## Open questions

- Exact `reason` detail vocabulary — the union is seeded (see the research
  amendment above) but finalizes in code during the TDD port as each proof
  internal lands.
- Whether `repair.unrepairable` needs a Runtime Recovery Choice operator menu
  or plain diagnostics is enough — decide when the repair path is ported.
- Parity checklist for the `browser-use` switchover — write when the package
  approaches parity.

## Resolved since (2026-07-03 plan + review)

- Launch race policy: post-spawn re-verify comparing verified-listener pid to
  own child pid; loser kills its own child only (tolerant of an already-exited
  pid, since Chrome's ProcessSingleton may retire it); failed kill →
  `spawned_unverified` reason `own_child_kill_failed`. No lock file.
- Second-launch refusal in the post-spawn pre-bind window: read the dedicated
  profile's `SingletonLock` through the seam (profile inspection, not an
  ownership record — ADR 0009-compatible).
- Post-spawn proof failure lands the new `launch.spawned_unverified` station
  (see amendment), not a re-emit with a mutation-pin override.
- Seam extension: `spawnChrome` returns `{ pid, kill() }` — the one deliberate
  change over the ported seam, required to terminate our own child without
  killing a foreign listener.
- Write-preview: `launch`/`repair` declare `previewExemption` naming `check`,
  not a phantom `check` execution mode (the facade has no cross-command preview
  vocabulary).
