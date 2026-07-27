# Browser Use Test Matrix

Purpose: prove the migrated chain — browser-connect connection → browser-use
targets/operate.

Current release-readiness ledger:
[`docs/plans/2026-07-27-daily-driver-acceptance-ledger.md`](docs/plans/2026-07-27-daily-driver-acceptance-ledger.md).
The ledger owns the full Daily Driver Acceptance Proof. This file retains
detailed live receipts and historical matrices referenced by that ledger.

Convention:

- Envelope source: `browser-connect connect <adapter> --json` (repo-local: `bun run runtime/browser-connect/src/cli.ts connect <adapter> --json`).
- browser-use commands run repo-local via `bun run <command>` from `skills/browser-use`.
- Live smoke ran 2026-07-16 (run ids `ae1-live-chain`, `ae2-recovery-live`, `ae4-fail-closed-live`): the foreign listener had vacated the default CDP port; `connect` launched and verified Agent Chrome (`.agent-warm-profile`). Prerequisite found during the run: the mcporter server `chrome-devtools` must point at the browser-connect pinned adapter with `--browser-url <verified endpoint verbatim>` — the legacy `npx chrome-devtools-mcp@latest --autoConnect` entry exits 1 and self-discovers, which the architecture forbids.

## Migrated Chain Matrix

| ID | Case | Chain | Expected | Kind | Status |
| --- | --- | --- | --- | --- | --- |
| AE1 | Run-id threading | `BROWSER_USE_RUN_ID=R BROWSER_USE_TARGET_STATE_DIR=<dir>` exported, then `browser-connect connect <adapter> --run-id R --json` → envelope → `targets list --mode handoff-bound --handoff <envelope> --json` → `targets select` → `operate snapshot` | Every envelope binding carries run id `R`; the run-scoped target-state path derives from `R` (select needs the explicit run id or `--state` — it fails closed otherwise). | live smoke | PASS (2026-07-16, run id `ae1-live-chain`: connect verified envelope → 1 candidate → run-scoped state carries the run id, endpoint identity, 15-min TTL → live a11y snapshot of the selected page; negative check: select without run id → `target_selection_state_path_missing` exit 20. Exposed and fixed a real-shape parser bug: adapter emits `N: Title (url) [flags]`, old parser matched bare URLs only.) |
| AE2 | Recovery discovery from envelope only | `targets list --mode recovery --adapter <id> --handoff <envelope> --json` with only the browser-connect envelope as evidence | Evidence-gathering candidates listed; `continuation.next_action_id` names an existing command. | live smoke | PASS (2026-07-16, run id `ae2-recovery-live`: 1 evidence-gathering candidate; continuation `connect_verified_browser`.) |
| AE3 | No dangling deleted-command references | `bun --filter browser-use-scripts test` → `src/command-contract-no-dangle.test.ts` | Zero references to deleted commands (`browser-adapter-router`, `preflight-browser-adapter`, `browser-adapter-map`) in surviving contracts, runtime action vocabulary, and rendered help. | permanent test | PASS |
| AE4 | Fail-closed connection entry | Agent Chrome stopped → `browser-connect connect <adapter> --json` | Exit `20`; failure envelope carries exactly one Repair Path with a live `runtime/browser-connect/REPAIR.md` anchor; no surviving browser-use path falls back to a cold browser. | live smoke | PASS (2026-07-16, run id `ae4-fail-closed-live`, exercised via an operator-owned foreign listener on the convention port: exit `20`, `foreign_listener`, exactly one Repair Path `use_suggested_port` → live anchor `REPAIR.md:553`; constraints included `no_adapter_fallback` + `no_process_destruction`; no launch, no fallback.) |

## Front-Door L-Tier Refresh (2026-07-27)

Serialized live journeys against Agent Chrome. Task execution used ONLY the
installed `browser-use` CLI (front-door driver rule; the historical receipts
above that drove `browser-connect`/adapters directly no longer count toward
tier L). Out-of-band controls remained operator-owned, not public product
surfaces: C01 setup/cleanup; C05 fault injection/cleanup; D26 fault
injection/cleanup; D27 setup/cleanup; H21 fault injection/cleanup. Workflow
`wf_89eb70b9-746`, three agents in sequence: connection (C01-C06),
operations (D01, D06-D13 subset), edge (D26, D27, H21). Environment facts:
the human default-profile Chrome squatted the explicit legacy override port
9222. The Warm Chrome default CDP port is 9242; 9222 is only an explicit
`WARM_CHROME_CDP_PORT`
override (empty `/json/version` — correctly refused as `foreign_listener`
throughout); every journey routed to Agent Chrome via `WARM_CHROME_CDP_PORT`.
Pinned agent-browser 0.31.2 (cached) was exposed on PATH;
chrome-devtools-mcp stayed at the
operator gate (1.2.0 cached vs pinned 1.5.0).

| Row | Verdict | Live receipt |
| --- | --- | --- |
| DDA-C01 | PASS | 2026-07-27 18:30 AEST / out-of-band stop: kill 7149 (SIGTERM to agent PID on 9223), verified 9223 listener gone + no agent-warm-profile process; then WARM_CHROME_CDP_PORT=9231 browser-use task run --intent debug --tab 0 --allowed-origin http://127.0.0.1:8912 --json. stderr: warm-chrome check command-start port=9231 -> endpoint_unreachable -> cold launch -> new PID 52160 --remote-debugging-port=9231 --user-data-dir=/Users/nathanvale/.agent-warm-profile, lsof 52160 LISTEN 9231. Before: agent-warm-profile PIDs NONE. Exactly one launch. Decision browser-use-front-door-003 classifies stop and fixture teardown as operator-owned, not a public product surface. |
| DDA-C02 | PASS | 2026-07-27 18:29 AEST / WARM_CHROME_CDP_PORT=9223 browser-use task run --intent debug --tab 2 --allowed-origin http://127.0.0.1:8912 --json run twice: RUN1 ok run_id 136681a0 state=confirmed adapter=chrome-devtools-mcp handoff_evidence_id=50ed4882 dur 3139ms; RUN2 ok state=confirmed handoff_evidence_id=e79283ce dur 3160ms. Explicit reuse flag via scrape probe envelope: launch.launched=false, environment.name=agent-chrome. Corroboration: warm PID 7149 stable before/after; Chrome main count stable 2->2; no new PID. |
| DDA-C03 | PASS | 2026-07-27 18:31 AEST / human Chrome PID 12118 LISTEN 127.0.0.1:9222 (bare Google Chrome, no debug flag, empty /json/version) live alongside agent Chrome PID 52160 on 9231. WARM_CHROME_CDP_PORT=9231 browser-use task run --intent debug --tab 2 --allowed-origin http://127.0.0.1:8912 --json -> ok, run.environment_profile={environment:agent-chrome,profile:default}, adapter chrome-devtools-mcp, state confirmed, handoff_evidence_id 74fdd3f0. Every envelope reported environment agent-chrome; 9222 human listener only ever refused (foreign_listener), never selected. |
| DDA-C04 | N/A | Decision browser-use-front-door-004: v1 has one Browser Connect identity, agent-chrome/default; Warm Chrome owns its physical profile path, so a public wrong-profile request is outside the product model. Adjacent live safety receipt, 2026-07-27 18:31 AEST: WARM_CHROME_CDP_PORT=9222 task run against the human-profile listener -> exit 20 foreign_listener before adapter, launch.launched=false, no selected lane, no_adapter_fallback. |
| DDA-C05 | PASS | 2026-07-27 18:32 AEST / bun dummy listener 127.0.0.1:9232 (200 not a CDP endpoint). WARM_CHROME_CDP_PORT=9232 browser-use task run --intent debug --tab 0 --allowed-origin http://127.0.0.1:8912 --json -> exit 20 code=foreign_listener, retryable=false, next_action_id=use_suggested_port, constraints[no_adapter_fallback,no_internal_port_switch,no_unverified_listener_connection,no_process_destruction], dur 104ms. Attempts: command-start=1, foreign_listener=1 (no storm). Killed dummy 53322; WARM_CHROME_CDP_PORT=9231 ... --tab 2 -> ok/confirmed/agent-chrome (recovery proven). |
| DDA-C06 | N/A | Decision browser-use-front-door-005: Agent Chrome is defined by a verified CDP endpoint; remote-debugging-off removes the product capability and stays an external fault fixture. Adjacent live receipt, 2026-07-27 18:32 AEST: unavailable requested endpoint -> exit 20 launch_failed, requires_operator, inspect_diagnostics, one launch attempt, no storm, no orphan. |
| DDA-D01 | PARTIAL | 2026-07-28 AEST / `WARM_CHROME_CDP_PORT=9231 browser-use targets list --mode handoff-bound --adapter agent-browser --json` auto-minted a handoff and passed handoff validation without browser-connect, then exited 20 with `target_discovery_transport_failed`: `Browser Target Discovery is not implemented for adapter agent-browser yet.` Continuation `change_target_discovery_input`; duration `287ms`. Auto-minting is proven. Remaining gap: implement the agent-browser target discovery transport; target listing did not succeed. |
| DDA-D06 | PASS | 2026-07-28 AEST / WARM_CHROME_CDP_PORT=9231, agent-browser 0.31.2, real Chrome 150, loopback fixture 127.0.0.1:8912 (Save button reveals `[data-persisted='true']`). `browser-use task run --intent routine-automation --click-role button --click-name Save --postcondition-id saved --expect-visible "[data-persisted='true']" --tab t1 --allowed-origin http://127.0.0.1:8912 --json` -> status ok, selected_lane agent-browser, lane_source intent-preferred, run confirmed, mutation_dispatched true, executed_steps 2 (snapshot+click), external_effect none, postcondition {id:saved} confirmed from fresh visibility, handoff_evidence_id aa347b34d6c30bda… (auto-minted, no browser-connect). Hermetic proof (exactly-one, write-ahead dispatch, refuse-before-mutation on zero/multiple/drift/invalid-selector) backs it. |
| DDA-D07 | BLOCKED | 2026-07-27 18:45 AEST / WARM_CHROME_CDP_PORT=9231, chrome-devtools-mcp 1.2.0 on PATH / `browser-use task run --intent debug --tab 0 --allowed-origin http://127.0.0.1:54159 --json` -> status error, exit 20, error.code adapter_not_installed, detail 'chrome-devtools-mcp version 1.2.0 does not match pinned 1.5.0.', continuation requires_operator true, constraint no_pin_policy_change, choice install_registered_adapter_manually. Cached: only ~/.bun/install/cache/chrome-devtools-mcp@1.2.0; pin CHROME_DEVTOOLS_MCP_PINNED_VERSION=1.5.0. Compounded by the same no-front-door-mutation gap as D06. |
| DDA-D09 | PASS | 2026-07-28 AEST / port 9231, agent-browser 0.31.2, real Chrome 150, fixture 127.0.0.1:8912 (Save + Cancel buttons). A target absent from the current snapshot: `browser-use task run --intent routine-automation --click-role button --click-name Submit --postcondition-id saved --expect-visible "[data-persisted='true']" --tab t1 --allowed-origin http://127.0.0.1:8912 --json` -> exit 20, task_run_lane_refused, lane_outcome agent_browser_ref_invalid, "The semantic click target did not resolve to exactly one ref in the current task-local snapshot", external_effect none, no click dispatched. The exactly-one rule holds live; a ref whose current semantics differ cannot cross the mutation boundary. |
| DDA-D10 | BLOCKED | 2026-07-27 18:45 AEST / same chrome-devtools-mcp pin block as D07: `task run --intent debug` -> exit 20 adapter_not_installed 'version 1.2.0 does not match pinned 1.5.0', no_pin_policy_change, requires_operator. No chrome-devtools mutation path reachable; stale-ref refusal path (chrome baseline is read-only console+network, browser-use-chrome-task.ts) never constructed via `task run`. |
| DDA-D12 | PASS | 2026-07-28 AEST / port 9231, agent-browser 0.31.2, real Chrome 150, fixture 127.0.0.1:8912. A dispatched Save click whose postcondition selector can never be proven: `... --click-name Save --postcondition-id vanish --expect-visible "#does-not-exist-at-all" ...` -> exit 20, lane_outcome agent_browser_mutation_effect_unknown, external_effect unknown, error task_run_effect_unknown, retryable false, continuation inspect_task_run_result (never retry), run_id 2616f9f4…. No-repeat holds structurally (retryable false + terminal unknown; hermetic proof asserts exactly one click + terminal-truth resume refusal, CAS-persisted dispatch across the crash window). |
| DDA-D13 | PASS | 2026-07-28 AEST / port 9231, agent-browser 0.31.2, real Chrome 150, fixture 127.0.0.1:8912 whose DOM carries ambient "Saved successfully" text plus a present-but-hidden `[data-decoy='true']`. Save click with a false named postcondition: `... --click-name Save --postcondition-id decoyfalse --expect-visible "[data-decoy='true']" ...` -> exit 20, lane_outcome agent_browser_postcondition_not_achieved, "Fresh structure did not satisfy the declared mutation postcondition", external_effect unknown (conservative post-dispatch truth), run_id bf527282…. The ambient "Saved successfully" text never reached stdout (leak count 0): only the named structural postcondition governs success. |
| DDA-D26 | PARTIAL | 2026-07-27 18:58 AEST. Reduced Agent Chrome to zero page targets via out-of-band CDP close (json/close cascade); CDP still alive on 9231, /json/list page targets=0, target types []. Front-door `WARM_CHROME_CDP_PORT=9231 browser-use task run --intent debug --tab 0 --allowed-origin http://127.0.0.1:8971 --json` -> exit 20, typed task_run_not_achieved / lane_outcome chrome_task_target_unavailable, stderr empty (0 lines, no stack trace) = never a crash. GAP: the named oracle code target_discovery_no_candidates + continuation open_browser_target belongs to `targets list`; front-door `targets list --mode recovery --adapter chrome-devtools-mcp --json` against zero pages -> target_discovery_transport_failed / supply_verified_handoff (needs forbidden browser-connect mint). Agent Chrome restored to 2 tabs, final green run confirmed (tab 1, state confirmed). |
| DDA-D27 | PARTIAL | 2026-07-27 18:57 AEST. Opened 50 new fixture tabs (one carrying needle-unique-report) via out-of-band CDP against 9231 -> 52 total page targets, needle_present=true (loopback fixture on 127.0.0.1:8971). Front door stayed bounded with 52 tabs: `WARM_CHROME_CDP_PORT=9231 browser-use task run --intent debug --tab 1 --allowed-origin http://127.0.0.1:8971 --json` -> status ok, state confirmed, 2 steps, 2969ms; `--tab 2` -> typed task_run_lane_refused chrome_task_target_origin_refused (origin bounding works live); no crash, no budget blowup. GAP: `browser-use targets list --mode recovery --adapter chrome-devtools-mcp --show-url --json` -> exit 20 target_discovery_transport_failed, continuation supply_verified_handoff — the candidate-list/ordinal/redaction surface hard-requires `browser-connect connect --handoff` (forbidden by driver rule); `task run` --debug stderr carries zero candidate/ordinal projection. All 51 fixture tabs closed afterward. |
| DDA-H21 | PASS | 2026-07-27 18:56 AEST. Located real durable store: $HOME/.local/state/browser-use/leases/4752fffbf37d52deee5f9de3839bfe6c.json (sha256 of 'agent-chrome\0default', first 32 hex; confirmed via `browser-use repair status --json`). Backed up current lease, then surgically seeded ONE lease entry: holder=task-run-CRASHED-FAKE-H21-9f3c1a, fencing_token=50, expired (expires_at 1785100000050, far past). `browser-use repair status --json` read it: holder task-run-CRASHED-FAKE-H21-9f3c1a token 50 live=False. Live front-door run `WARM_CHROME_CDP_PORT=9231 browser-use task run --intent debug --tab 1 --allowed-origin http://127.0.0.1:8971 --json` -> status ok, state confirmed, adapter chrome-devtools-mcp, run 90bc9ccf. Lease after: new holder task-run-90bc9ccf..., fencing_token=51 (monotonic 50->51), recovered_from={fencing_token:50, holder_id:'task-run-CRASHED-FAKE-H21-9f3c1a', observed_expired_at_epoch_ms:1785142577881}. Post-recovery `repair status`: status ok, orphan_temp_files [], pending_tombstones [], leases healthy. Matches hermetic oracle (browser-use-process-hygiene.test.ts fenced-takeover + recovered_from). Distinct fake holder id used; store left healthy. |

## Envelope-Derived Transport Matrix (refactor U1 proof)

Proof-first pin for the envelope-derived ad-hoc mcporter invocation (`--stdio
<pinned adapter> --stdio-arg --browser-url --stdio-arg <endpoint.http>
--stdio-arg --experimentalPageIdRouting`, env guard `MCPORTER_NO_KEEPALIVE=*`),
captured empirically before the U3 transport change lands. Argv contract
constant: `ENVELOPE_ADAPTER_ARGV_CONTRACT` in
`src/mcporter-adapter-process-boundary.test.ts`.

| ID | Case | Chain | Expected | Kind | Status |
| --- | --- | --- | --- | --- | --- |
| U1-ET1 | Hermetic invocation + fail-closed + taxonomy proof | `src/mcporter-adapter-process-boundary.test.ts` via `skills/test-runner/src/test-runner.sh` — real mcporter + pinned chrome-devtools-mcp 1.5.0 adapter (both hard-required; the test fails with install guidance instead of skipping — no remote CI, the local suite is the gate) | Ad-hoc argv accepted; unreachable endpoint fails closed (non-zero exit, `Could not connect to Chrome`, `isError: true`, no page listing — the daemon-shadow tripwire); missing adapter binary routes to `dependency_missing` through the real taxonomy via the ENOENT text (mcporter exits 1, not 127); the captured success envelopes feed the current discovery and operate-snapshot parsers unchanged. | permanent test | PASS (2026-07-17, 5 tests / 28 expect calls via test-runner) |
| U1-ET2 | Live success-shape capture | Orchestrator live capture against real Agent Chrome on the verified endpoint through the exact pinned invocation | `list_pages` and pageId-routed `take_snapshot` envelopes captured verbatim; embedded as redacted fixtures (personal FastTrack page lines swapped for same-shape placeholders; `## Pages` / `## Latest page snapshot` shapes byte-for-byte) in `src/mcporter-adapter-process-boundary.test.ts`, which replays them through the real parsers on every run. | live smoke | PASS (2026-07-17, run id `u1-live-capture-2026-07-17`) |
| U6-ET3 | Full chain through the shipped envelope-derived transport | `browser-connect connect chrome-devtools-mcp --json --run-id u6-live-chain` → `targets list --mode handoff-bound --handoff <envelope> --json` → stdin-piped `targets select --url-contains example.com` → `operate snapshot --handoff <envelope>` (with `BROWSER_USE_RUN_ID` + `BROWSER_USE_TARGET_STATE_DIR` exported) | Verified envelope carries the absolute pinned `probe_executable`; list yields 3 operation-ready candidates with run id threaded; select resolves the hint to one candidate and writes run-scoped state; snapshot returns the SELECTED page (`Example Domain`, `truncated: false`) — pageId routing hit the hint-selected target, not the adapter's default-selected tab. No mcporter config entry consulted. | live smoke | PASS (2026-07-17, run id `u6-live-chain`) |
| U6-ET4 | Artifact operation through the new transport | Same run id: `operate screenshot --handoff <envelope> --out example.png` with `BROWSER_USE_ARTIFACT_ROOT` set | 114 KB PNG written under the run-scoped artifact root; absolute `--out` correctly rejected first with `browser_operation_artifact_path_unsafe` exit 2 (typed usage failure, unchanged taxonomy). | live smoke | PASS (2026-07-17, run id `u6-live-chain`) |

## Page Action Continuity Matrix (active)

Proves the rewritten `SKILL.md` `Page Actions` lifecycle reads true for both
current adapter shapes: adapter-native ref continuity from observation through
mutation, then completion decided from fresh structure. Safe/reversible only —
neutral `example.com` → `iana.org`, plus authored local fixture pages (`file://`)
for the conflicting-signal and ambiguous-outcome scenarios; pre-existing
personal/work tabs were not touched and no page-specific sensitive data was
captured.

| ID | Adapter | Continuity coordinates | Named postcondition | Mutation + fresh post-state | Class | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PAC1 | `agent-browser` (native CLI) | one session `pac-ab-2026-07-21`, verified endpoint via `--cdp <ws>` (from the browser-connect envelope), one active tab; ref `[ref=e2]` bound to the observed snapshot | after clicking `@e2` ("Learn more"), fresh `location.href` is `iana.org`, not `example.com` | `click @e2` → `✓ Done`; fresh `eval location.href` = `https://www.iana.org/help/example-domains` — decided by structure, not the `Done` text | confirmed | PASS (2026-07-21, run id `pac-ab-2026-07-21`) |
| PAC2 | `chrome-devtools-mcp` (MCP client + server process) | one MCP client and server process (pinned adapter, `--experimentalPageIdRouting`), one selected page `pageId 9`; ref `uid=1_3` bound to the observed snapshot | after clicking `uid=1_3` ("Learn more"), fresh RootWebArea `url` is `iana.org`, not `example.com` | `click {pageId:9,uid:"1_3"}` → "Successfully clicked"; fresh `take_snapshot` RootWebArea `url="https://www.iana.org/help/example-domains"` — decided by structure, not the click text | confirmed | PASS (2026-07-21, run id `pac-mcp-2026-07-21`) |
| PAC3 | `chrome-devtools-mcp` | same client/process/page as PAC2, after `navigate_page` back to `example.com` (a continuity break) | reusing the pre-navigation ref must not mutate; stale ref is invalid | replay `click {pageId:9,uid:"1_3"}` → hard-error `Element uid "1_3" not found on page 9` (post-nav snapshot re-namespaced refs `1_*`→`2_*`); no page change | not achieved (proven no-effect) | PASS (2026-07-21, run id `pac-mcp-2026-07-21`) |
| PAC4 | `agent-browser` | same session/endpoint/tab as PAC1, after `open example.com` (a continuity break) | reusing the pre-navigation ref must not mutate; treat return text as supporting evidence only | replay `click @e2` → `✗ Unknown ref: e2`; fresh `eval location.href` still `example.com` — structural check confirms no effect | not achieved (proven no-effect) | PASS (2026-07-21, run id `pac-ab-2026-07-21`) |
| PAC6 | `chrome-devtools-mcp` | ref `uid=1_3` minted in client + server process A against the selected page; process A exits; replacement client + server process B targets the same page | a replacement client must not reuse a prior ref | replay `click {pageId,uid:"1_3"}` in process B → hard-error `No snapshot found for page 6. Use take_snapshot to capture one.` — B refuses any uid until it snapshots, and its own fresh snapshot re-mints uids from `1_0`, so a carried ref would resolve against a different namespace; page unchanged | not achieved (proven no-effect) | PASS (2026-07-21, run id `pac6-mcp-replacement-2026-07-21`) |
| PAC5 | `agent-browser` | one session `pac5-ab-2026-07-21`, verified endpoint via `--cdp <ws>`, one tab on an authored fixture page whose save commits off-DOM with a deferred visible confirmation | after clicking Save, `#saved-banner` ("Saved") present in fresh structure | `click @e2` → `✓ Done`; fresh snapshot: no banner, structure identical — postcondition unproven AND no-effect unproven (a save can commit off-page); classify `unknown`; INSPECT without repeating: `eval window.__saveCount` → `1` — the save HAD committed exactly once off-DOM, so a retry would have been a duplicate; no second click issued | unknown (inspection resolved: committed once) | PASS (2026-07-21, run id `pac5-ab-2026-07-21`) |
| PAC7 | `chrome-devtools-mcp` | one client + server process, selected fixture page; ref `uid=1_2` (Log in) bound to the observed snapshot; stale text "Please verify your identity" present before and after | after clicking Log in, heading "Dashboard" (authenticated-workspace landmark) present in fresh structure | `click {pageId,uid:"1_2"}` → "Successfully clicked"; fresh snapshot: Dashboard landmark PRESENT while the stale verification language is STILL present in the same snapshot — the predeclared structural postcondition decides, ambient keywords are ignored | confirmed | PASS (2026-07-21, run id `pac7-ae3-2026-07-21`) |

Notes:

- PAC3/PAC4 exercise the discard-after-navigation rule (`SKILL.md` Page Actions) and the completion floor: this agent-browser build **rejects** the stale ref (`Unknown ref`) rather than the silent-success no-op the 2026-06-13 ref-staleness research measured on some stale clicks; only the fresh structural check catches every failure mode alike, because return text alone cannot distinguish real success from a silent no-op.
- PAC5 and PAC7 use authored local fixture pages (safe, no network, deleted-tab reversible) because the conflicting-signal and ambiguous-outcome page states cannot be manufactured honestly on a public site. The adapter chain (connect → observe → mutate → fresh verify) is live end-to-end; only the page content is authored.
- PAC5 is the no-automatic-repeat proof: at the structural-verify step the outcome was genuinely `unknown`, and inspection (not repetition) revealed the mutation had already committed once off-DOM — a retry would have been a duplicate save.
- Cleanup verified: 0 `example.com` or fixture pages remained via `/json/list` and `tab list`; only pre-existing tabs.

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
kind: live pairwise journey
status: pending
run_id: `bap-playwright-cdp-attach`
adapter: `playwright-cdp`
side_effects: check, network
requires: pinned Playwright CLI installed through Browser Connect's operator gate; Agent Chrome healthy; anonymous fixture page

run:
- [ ] Invoke only `browser-use task run --intent frontend-test --tab <index> --allowed-origin <origin> --json`.

expect:
- [ ] Internal Browser Connect mint selects `playwright-cdp`.
- [ ] Run reports `selected_lane=playwright-cdp` and `state=confirmed`.
- [ ] Playwright attaches only to the verified CDP endpoint.
- [ ] Requested tab index and fresh snapshot origin match the fixture.
- [ ] No browser launch, navigation, or mutation command runs.

cleanup:
- [ ] Named Playwright session detaches.
- [ ] Agent Chrome and the fixture tab remain running.

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
