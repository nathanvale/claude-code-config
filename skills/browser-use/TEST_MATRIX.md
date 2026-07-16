# Browser Use Test Matrix

Purpose: prove the migrated chain — browser-connect connection → browser-use
targets/operate.

Convention:

- Envelope source: `browser-connect connect <adapter> --json` (repo-local: `bun run runtime/browser-connect/src/cli.ts connect <adapter> --json`).
- browser-use commands run repo-local via `bun run <command>` from `skills/browser-use`.
- Live smoke is **pending-operator**: a foreign listener currently occupies the default CDP port on this machine; live smoke is deferred until an operator remediates the listener externally (`runtime/browser-connect/REPAIR.md#v1-inspect_listener`).

## Migrated Chain Matrix

| ID | Case | Chain | Expected | Kind | Status |
| --- | --- | --- | --- | --- | --- |
| AE1 | Run-id threading | `browser-connect connect <adapter> --run-id R --json` → envelope → `targets list --mode handoff-bound --handoff <envelope> --json` → `targets select` → `operate snapshot` | Every envelope carries run id `R`; the run-scoped target-state path derives from `R`. | live smoke | pending-operator |
| AE2 | Recovery discovery from envelope only | `targets list --mode recovery --adapter <id> --handoff <envelope> --json` with only the browser-connect envelope as evidence | Evidence-gathering candidates listed; `continuation.next_action_id` names an existing command. | live smoke | pending-operator |
| AE3 | No dangling deleted-command references | `bun --filter browser-use-scripts test` → `src/command-contract-no-dangle.test.ts` | Zero references to deleted commands (`browser-adapter-router`, `preflight-browser-adapter`, `browser-adapter-map`) in surviving contracts, runtime action vocabulary, and rendered help. | permanent test | PASS |
| AE4 | Fail-closed connection entry | Agent Chrome stopped → `browser-connect connect <adapter> --json` | Exit `20`; failure envelope carries exactly one Repair Path with a live `runtime/browser-connect/REPAIR.md` anchor; no surviving browser-use path falls back to a cold browser. | live smoke | pending-operator |

---

# ARCHIVED: Router-Era Warm Chrome Ledger (historical; do not execute)

> Archived 2026-07-16 (browser-connect migration U2). Everything below this
> banner is the pre-migration live-smoke record. `preflight-browser-adapter`
> and the Browser Adapter Router chain are deleted; the convention endpoint
> and profile values are Router-era setup detail. Warm Chrome environment
> proof now lives in `runtime/warm-chrome/tests/`; connection smoke belongs
> to `runtime/browser-connect`. Kept verbatim as history only.

Convention (historical):

- Primary CDP endpoint: `http://127.0.0.1:9222`
- Primary profile: `~/.agent-warm-profile`
- Startup URL for launched Chrome: `https://example.com/`
- Debug mode: add `--debug --json --run-id <case-id>`
- Success signal: JSON envelope plus diagnostics tell same story.
- Failure signal: `error.hint`, `runtime_actions`, and `continuation.next_action_id` point at one safe next step.
- Page signal: every real Chrome setup opens `https://example.com/`; every successful launch/reuse run checks `/json/list` for a `page` target at that URL.

## Live Matrix (archived)

| ID | Case | Setup | Command | Expected CLI Contract | Expected Observability | Status | Result Notes | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Restart cold launch | No Chrome listeners. Stale or existing `~/.agent-warm-profile` on disk. | `preflight-warm-chrome.ts launch --debug --json --run-id restart-cold-debug`; inspect `/json/list`. | `status=ok`; `launch_performed=true`; `runtime_actions[0]=use_verified_endpoint`; `continuation.next_action_id=use_verified_endpoint`; `repair_actions=["devtools_active_port"]`; page target is `https://example.com/`. | `command-start` -> `launch-started` -> `preflight-check` -> `repair-actions` -> `preflight-ready`; run id on every diagnostic; no profile path leak in diagnostics. | PASS | `browser_pid=60525`; duration `1320ms`; proof file rewritten to `9222` and fresh browser path. | Kill test Chrome at end. |
| C2 | Warm launch reuse | `9222` already healthy with `~/.agent-warm-profile`, opened to `https://example.com/`. | `preflight-warm-chrome.ts launch --debug --json --run-id warm-reuse-debug`; inspect `/json/list`. | `status=ok`; `launch_performed=false`; `repair_actions=["devtools_active_port"]`; `next_action_id=use_verified_endpoint`; page target remains `https://example.com/`. | `command-start` -> `launch-reuse` -> `preflight-check` -> `repair-actions` -> `preflight-ready`; no spawn. | PASS | `browser_pid=60525`; duration `58ms`; proof-file refresh observable. | Keep or kill at end. |
| C3 | Read-only check | `9222` healthy with `~/.agent-warm-profile`, opened to `https://example.com/`. | `preflight-warm-chrome.ts check --debug --json --run-id warm-check-debug`; inspect `/json/list`. | `status=ok`; `launch_performed=false`; `repair_actions=[]`; `next_action_id=use_verified_endpoint`; page target remains `https://example.com/`. | `command-start` -> `preflight-check` -> `preflight-ready`; no `repair-actions`; no writes. | PASS | `profile=inferred`; duration `46ms`; read-only path clean. | None. |
| C4 | Wrong requested port while primary healthy | `9222` healthy with `~/.agent-warm-profile`, opened to `https://example.com/`; caller asks for `9333`. | `preflight-warm-chrome.ts launch --port 9333 --debug --json --run-id wrong-port-debug`; inspect primary `/json/list`. | Exit `2`; `code=warm_chrome_already_running`; `failure_domain=input`; `hint.action=change_input`; `runtime_actions[0]=change_input`; no spawn; no writes; primary page target remains `https://example.com/`. | Diagnostics show primary `9222` verified as `command=check`; no `repair-actions`; final error has same run id. | PASS | duration `43ms`; clean `change_input` guidance; no proof write. | None. |
| C5 | Old adapter Chrome open, no primary | `9223` Chrome with `~/.agent-prose-replay-profile`, opened to `https://example.com/`; no `9222`. | `preflight-warm-chrome.ts launch --debug --json --run-id old-port-open-debug`; inspect both `/json/list` endpoints. | `status=ok`; launches `9222`; ignores unrelated `9223`; `launch_performed=true`; both page targets are `https://example.com/`. | Diagnostics mention only requested `9222`; no confusion with `9223`. | PASS | `9223` PID `63702`; new `9222` PID `63833`; duration `648ms`; diagnostics stayed on `9222`. | Kill both test Chromes. |
| C6 | Non-Chrome listener on primary port | HTTP server owns `9222`; no Chrome CDP. | `preflight-warm-chrome.ts launch --debug --json --run-id non-chrome-9222-debug` | Failure; no Chrome spawn; `not_real_google_chrome` or listener inspection action; no adapter fallback if wrong-browser risk applies. | Diagnostics identify `listener-detected` with `port=9222` and `listener_pid`, then the error; no command/profile leak. | PASS | Valid run must keep HTTP server alive in same shell. Latest run `occupied-9222-live`: exit `20`; `listener-detected` before `not_real_google_chrome`; `runtime_actions[0]=inspect_listener`; `no_adapter_fallback` present; duration `48ms`. | Kill HTTP server. |
| C7 | Real Chrome on primary with wrong profile | Real Chrome owns `9222` with a temporary dedicated profile, opened to `https://example.com/`, not `~/.agent-warm-profile`. | `preflight-warm-chrome.ts check --debug --json --run-id wrong-profile-debug`; inspect `/json/list`. | Exit `2`; `code=profile_mismatch`; `failure_domain=input`; `hint.action=change_input`; `runtime_actions[0]=change_input`; page target is `https://example.com/`. | Diagnostics show verified listener but redact profile path. | PASS | PID `65848`; exit `2`; duration `49ms`; clean `change_input` guidance. | Kill temporary Chrome; delete temp profile. |
| C8 | Real Chrome on primary without CDP | Real Chrome listener exists, opened to `https://example.com/`, but `/json/version` does not answer as CDP. | `preflight-warm-chrome.ts launch --debug --json --run-id chrome-no-cdp-debug` | Failure; no duplicate spawn; `runtime_actions[0]=inspect_listener`. | Diagnostics lead to inspect, not launch loop. | UNIT-COVERED | Live setup not run; hard to create faithfully without browser-level manipulation. Unit case: `preflight-warm-chrome.test.ts` test `"occupied real Chrome without CDP routes to listener inspection"`. | None. |
| C9 | Unsafe profile permissions | Isolated test profile mode set to `755`; temporary Chrome opened to `https://example.com/`. | `check`, then `repair`; inspect `/json/list`. | `check` fails with `repair_profile`; `repair` chmods and rewrites proof; page target remains `https://example.com/`. | Repair diagnostics list action names, not profile path. | PASS | `check`: exit `20`, `runtime_actions[0]=repair_profile`, `no_adapter_fallback` present. `repair`: `repair_actions=["profile_permissions","devtools_active_port"]`, final mode `700`. | Killed temp Chrome; removed temp profile. |
| C10 | Stale proof file while Chrome healthy | `9222` healthy, opened to `https://example.com/`; `DevToolsActivePort` points to `9999` and stale browser path. | `check`, then `launch`; inspect `/json/list`. | `check` succeeds without writes; `launch` rewrites proof file; page target remains `https://example.com/`. | `check` has no `repair-actions`; `launch` has `repair-actions=["devtools_active_port"]`. | PASS | `check` left stale proof intact. `launch` rewrote proof to `9222` and browser path `d8eb0251...`; duration `47ms`. | Fresh proof restored. |
| C11 | Startup URL | No `9222` listener; primary profile exists. | `launch --debug --json --run-id example-startup-url-debug`, then inspect `/json/list`. | `status=ok`; `launch_performed=true`; page target URL is `https://example.com/`. | Launch diagnostics match cold-start path; target list proves visible page. | PASS | `browser_pid=69300`; `/json/list` contained `page https://example.com/`; duration `843ms`. | Killed `9222`. |
| C12 | CDP off / no listener | No `9222` listener; no Warm Chrome process; remote debugging disabled in `chrome://inspect/#remote-debugging`. | `check --debug --json --run-id remote-debugging-off-hard-fail`. | Exit `20`; `code=endpoint_unreachable`; hint says remote debugging is off; `hint.docs_url` points to Chrome docs; `runtime_actions[0]=enable_remote_debugging`; `continuation.next_action_id=enable_remote_debugging`; `no_adapter_fallback` present. | Failure diagnostics are fast and correlated: `command-start` -> `preflight-check` -> `endpoint_unreachable`. No launch or repair diagnostics. | PASS | Final check run `remote-debugging-off-hard-fail`: duration `6ms`; hard-fail continuation; docs URL present. | None. |

## Browser Adapter Proof Cases (archived; command deleted)

### BAP-C1 Chrome DevTools healthy mcporter

case_id: `bap-chrome-devtools-healthy`
kind: live smoke
status: ready
run_id: `bap-chrome-devtools-healthy`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; mcporter config uses `--browserUrl http://127.0.0.1:9222`

setup:
- [ ] Run Warm Chrome Preflight.
- [ ] Confirm `mcporter config get chrome-devtools --json` points at `9222`.

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-chrome-devtools-healthy`

expect:
- [ ] `status=ok`
- [ ] `continuation.next_action_id=use_verified_browser_adapter`
- [ ] `data.warm_chrome_run_id` present
- [ ] `data.diagnostics.selected_config_source=mcporter`

cleanup:
- [ ] No browser or config mutation expected.

### BAP-C2 Chrome DevTools stale config

case_id: `bap-chrome-devtools-stale`
kind: live diagnostic
status: ready
run_id: `bap-chrome-devtools-stale`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; temporary or controlled Chrome DevTools config points at `9223`

setup:
- [ ] Capture current adapter config.
- [ ] Point controlled config at `http://127.0.0.1:9223`.

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-chrome-devtools-stale`

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_config_stale`
- [ ] `continuation.next_action_id=update_adapter_config`
- [ ] `continuation.constraints` includes `no_adapter_fallback`
- [ ] Diagnostics name observed bad port `9223`

cleanup:
- [ ] Restore captured adapter config.

### BAP-D1 Selected dependency failure outranks stale native config

case_id: `bap-selected-dependency-outranks-native-stale`
kind: live diagnostic
status: ready
run_id: `bap-selected-dependency-outranks-native-stale`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; non-selected native config can point at stale `9223`; controlled PATH or runtime fixture hides selected dependency

setup:
- [ ] Capture current PATH and adapter config.
- [ ] Hide PATH `mcporter` for this command, or use a fixture that returns command-not-found from selected mcporter config lookup.
- [ ] Leave a stale non-selected native config present if available.

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-selected-dependency-outranks-native-stale`

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_dependency_missing`
- [ ] `continuation.next_action_id=configure_adapter_dependency`
- [ ] `continuation.constraints` includes `no_adapter_fallback`
- [ ] Diagnostics source is `mcporter`, not the stale native config.
- [ ] Stale native `9223` does not mask the selected dependency failure.

cleanup:
- [ ] Restore PATH and adapter config.

### BAP-D2 mcporter command missing

case_id: `bap-mcporter-command-missing`
kind: live diagnostic
status: ready
run_id: `bap-mcporter-command-missing`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; controlled PATH or runtime fixture hides PATH `mcporter` or configured runner

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-mcporter-command-missing`

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_dependency_missing`
- [ ] Hint names PATH `mcporter`, `BROWSER_USE_MCPORTER_COMMAND_JSON`, or configured runner.
- [ ] `continuation.next_action_id=configure_adapter_dependency`
- [ ] `no_adapter_fallback` present

cleanup:
- [ ] Restore PATH.

### BAP-D3 mcporter missing

case_id: `bap-mcporter-missing`
kind: live diagnostic
status: ready
run_id: `bap-mcporter-missing`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; controlled PATH or runtime fixture where `mcporter` cannot resolve

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-mcporter-missing`

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_dependency_missing`
- [ ] `continuation.next_action_id=configure_adapter_dependency`
- [ ] `no_adapter_fallback` present

cleanup:
- [ ] Restore PATH or tool cache.

### BAP-D4 Chrome DevTools MCP missing

case_id: `bap-chrome-devtools-mcp-missing`
kind: live diagnostic
status: ready
run_id: `bap-chrome-devtools-mcp-missing`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; mcporter config exists; controlled tool cache or fixture where `chrome-devtools-mcp` cannot start

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-chrome-devtools-mcp-missing`

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_dependency_missing`
- [ ] Error or hint names Chrome DevTools MCP.
- [ ] `continuation.next_action_id=configure_adapter_dependency`
- [ ] `no_adapter_fallback` present

cleanup:
- [ ] Restore tool cache/config.

### BAP-C3 agent-browser pinned CDP

case_id: `bap-agent-browser-pinned`
kind: future live smoke
status: pending
run_id: `bap-agent-browser-pinned`
adapter: `agent-browser`
side_effects: check, network
requires: agent-browser installed; named session exists; Warm Chrome healthy on `9222`

run:
- [ ] Future proof CLI: verify named `agent-browser` session with `--session "$S" --headed --cdp 9222` after the adapter contract accepts `agent-browser`.

expect:
- [ ] `get cdp-url` proves `9222`
- [ ] `tab list` succeeds
- [ ] No Chrome for Testing signal

cleanup:
- [ ] No browser or config mutation expected.

### BAP-C4 agent-browser missing cdp pin

case_id: `bap-agent-browser-missing-cdp`
kind: future diagnostic
status: pending
run_id: `bap-agent-browser-missing-cdp`
adapter: `agent-browser`
side_effects: check, network
requires: agent-browser installed; named session exists

run:
- [ ] Run a controlled proof-grade comparison without `--cdp`.

expect:
- [ ] Proof rejects unpinned or sticky daemon path.
- [ ] `continuation.next_action_id=inspect_adapter_config`
- [ ] `no_adapter_fallback` present

cleanup:
- [ ] Stop any accidental agent-browser daemon state before next case.

### BAP-C5 Playwright-CDP attach

case_id: `bap-playwright-cdp-attach`
kind: future live smoke
status: pending
run_id: `bap-playwright-cdp-attach`
adapter: `playwright-cdp`
side_effects: check, network
requires: Playwright runtime available; Warm Chrome healthy on `9222`

run:
- [ ] Future proof CLI: verify Playwright `connectOverCDP` attaches to `http://127.0.0.1:9222` after the adapter contract accepts `playwright-cdp`.

expect:
- [ ] Playwright `connectOverCDP` attaches to verified endpoint.
- [ ] No launch API called.

cleanup:
- [ ] Close Playwright connection only; keep Warm Chrome running.

### BAP-C6 Playwright launch rejected

case_id: `bap-playwright-launch-rejected`
kind: future diagnostic
status: pending
run_id: `bap-playwright-launch-rejected`
adapter: `playwright-cdp`
side_effects: check
requires: controlled launch-path fixture

run:
- [ ] Run proof against fixture that would call Playwright launch.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_auto_launch_risk`
- [ ] `no_adapter_fallback` present

cleanup:
- [ ] No launched browser expected.

### BAP-S1 example.com adapter smoke

case_id: `bap-example-smoke`
kind: explicit smoke
status: ready
run_id: `bap-example-smoke`
adapter: `chrome-devtools`
side_effects: browser, network
requires: Browser Adapter Proof success for `chrome-devtools`

run:
- [ ] Navigate via adapter to `https://example.com/`.
- [ ] List pages/tabs through same adapter.

expect:
- [ ] Visible page URL is `https://example.com/`.
- [ ] Cleanup leaves no extra listener/process state.

cleanup:
- [ ] Close only tabs opened by this smoke case when needed.

### BAP-S2 plain status smoke

case_id: `bap-plain-status-smoke`
kind: live smoke
status: ready
run_id: `bap-plain-status-smoke`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; mcporter config uses `--browserUrl http://127.0.0.1:9222`

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts status --adapter chrome-devtools --port 9222 --plain --run-id bap-plain-status-smoke`

expect:
- [ ] Exit `0`
- [ ] Plain output includes `adapter_ready`
- [ ] Plain output includes `action=use_verified_browser_adapter`
- [ ] Plain output includes `warm_chrome_run_id=...`

cleanup:
- [ ] No browser or config mutation expected.

### BAP-S3 no explicit port smoke

case_id: `bap-no-explicit-port`
kind: live smoke
status: ready
run_id: `bap-no-explicit-port`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on default `9222`; mcporter config uses `--browserUrl http://127.0.0.1:9222`

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --json --run-id bap-no-explicit-port`

expect:
- [ ] Exit `0`
- [ ] `status=ok`
- [ ] `data.port=9222`
- [ ] `data.action=adapter_ready`
- [ ] `continuation.next_action_id=use_verified_browser_adapter`

cleanup:
- [ ] No browser or config mutation expected.

### BAP-D5 Warm Chrome failure composition

case_id: `bap-warm-chrome-failure-composition`
kind: live diagnostic
status: ready
run_id: `bap-warm-chrome-failure-composition`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome failure on requested `9333`; selected adapter config may be healthy

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9333 --json --run-id bap-warm-chrome-failure-composition`

expect:
- [ ] Non-zero exit.
- [ ] Error comes from Warm Chrome/browser-entry handoff, not adapter config.
- [ ] `failure_domain=browser_entry_handoff` or equivalent Warm Chrome failure domain.
- [ ] `continuation.next_action_id` matches Warm Chrome guidance.
- [ ] Adapter subprocess/config proof does not run.

cleanup:
- [ ] Restore normal Warm Chrome endpoint state if setup changed it.

### BAP-D6 mcporter config missing

case_id: `bap-mcporter-config-missing`
kind: live diagnostic
status: ready
run_id: `bap-mcporter-config-missing`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; controlled fixture where `mcporter config get chrome-devtools --json` exits non-zero without command-not-found text

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-mcporter-config-missing`

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_config_missing`
- [ ] `continuation.next_action_id=update_adapter_config`
- [ ] `no_adapter_fallback` present

cleanup:
- [ ] Restore adapter config fixture or real config.

### BAP-D7 mcporter config unparsable

case_id: `bap-mcporter-config-unparsable`
kind: live diagnostic
status: optional
run_id: `bap-mcporter-config-unparsable`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; controlled fixture where `mcporter config get` returns `not-json`

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-mcporter-config-unparsable`

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_output_unparsable`
- [ ] `continuation.next_action_id=inspect_adapter_config`
- [ ] `no_adapter_fallback` present

cleanup:
- [ ] Restore adapter config fixture or real config.

### BAP-D8 list pages unparsable

case_id: `bap-list-pages-unparsable`
kind: live diagnostic
status: optional
run_id: `bap-list-pages-unparsable`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; healthy config; controlled fixture where `chrome-devtools.list_pages` returns invalid JSON

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-list-pages-unparsable`

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_output_unparsable`
- [ ] `continuation.next_action_id=inspect_adapter_config`
- [ ] `no_adapter_fallback` present

cleanup:
- [ ] Restore adapter fixture.

### BAP-S4 list pages empty weak signal

case_id: `bap-list-pages-empty`
kind: live smoke
status: optional
run_id: `bap-list-pages-empty`
adapter: `chrome-devtools`
side_effects: check, network
requires: Warm Chrome healthy on `9222`; healthy config; controlled fixture where `chrome-devtools.list_pages` returns `[]`

run:
- [ ] `skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port 9222 --json --run-id bap-list-pages-empty`

expect:
- [ ] Exit `0`
- [ ] Warning includes `adapter_signal_weak`
- [ ] `continuation.next_action_id=use_verified_browser_adapter`

cleanup:
- [ ] Restore adapter fixture.

## Coverage Notes (archived)

- Live cases avoid opening the everyday default Chrome profile.
- Default-profile rejection stays unit-covered unless explicitly approved for a risky live run.
- Each case should record both stdout envelope and stderr diagnostic chain.
- Cleanup must leave no stray `9222`, `9223`, HTTP server, or temporary profile process.
- Final cleanup from latest run: no `9222`; no `9223`; no `.agent-test-*` profiles.
