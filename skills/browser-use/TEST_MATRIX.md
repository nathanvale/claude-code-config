# Warm Chrome Test Matrix

Purpose: rerun Warm Chrome CLI smoke cases and judge observability, agent hints, and cleanup.

Convention:

- Primary CDP endpoint: `http://127.0.0.1:9222`
- Primary profile: `~/.agent-warm-profile`
- Startup URL for launched Chrome: `https://example.com/`
- Debug mode: add `--debug --json --run-id <case-id>`
- Success signal: JSON envelope plus diagnostics tell same story.
- Failure signal: `error.hint`, `runtime_actions`, and `continuation.next_action_id` point at one safe next step.
- Page signal: every real Chrome setup opens `https://example.com/`; every successful launch/reuse run checks `/json/list` for a `page` target at that URL.

## Live Matrix

| ID | Case | Setup | Command | Expected CLI Contract | Expected Observability | Status | Result Notes | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Restart cold launch | No Chrome listeners. Stale or existing `~/.agent-warm-profile` on disk. | `preflight-warm-chrome.sh launch --debug --json --run-id restart-cold-debug`; inspect `/json/list`. | `status=ok`; `launch_performed=true`; `runtime_actions[0]=use_verified_endpoint`; `continuation.next_action_id=use_verified_endpoint`; `repair_actions=["devtools_active_port"]`; page target is `https://example.com/`. | `command-start` -> `launch-started` -> `preflight-check` -> `repair-actions` -> `preflight-ready`; run id on every diagnostic; no profile path leak in diagnostics. | PASS | `browser_pid=60525`; duration `1320ms`; proof file rewritten to `9222` and fresh browser path. | Kill test Chrome at end. |
| C2 | Warm launch reuse | `9222` already healthy with `~/.agent-warm-profile`, opened to `https://example.com/`. | `preflight-warm-chrome.sh launch --debug --json --run-id warm-reuse-debug`; inspect `/json/list`. | `status=ok`; `launch_performed=false`; `repair_actions=["devtools_active_port"]`; `next_action_id=use_verified_endpoint`; page target remains `https://example.com/`. | `command-start` -> `launch-reuse` -> `preflight-check` -> `repair-actions` -> `preflight-ready`; no spawn. | PASS | `browser_pid=60525`; duration `58ms`; proof-file refresh observable. | Keep or kill at end. |
| C3 | Read-only check | `9222` healthy with `~/.agent-warm-profile`, opened to `https://example.com/`. | `preflight-warm-chrome.sh check --debug --json --run-id warm-check-debug`; inspect `/json/list`. | `status=ok`; `launch_performed=false`; `repair_actions=[]`; `next_action_id=use_verified_endpoint`; page target remains `https://example.com/`. | `command-start` -> `preflight-check` -> `preflight-ready`; no `repair-actions`; no writes. | PASS | `profile=inferred`; duration `46ms`; read-only path clean. | None. |
| C4 | Wrong requested port while primary healthy | `9222` healthy with `~/.agent-warm-profile`, opened to `https://example.com/`; caller asks for `9333`. | `preflight-warm-chrome.sh launch --port 9333 --debug --json --run-id wrong-port-debug`; inspect primary `/json/list`. | Exit `2`; `code=warm_chrome_already_running`; `failure_domain=input`; `hint.action=change_input`; `runtime_actions[0]=change_input`; no spawn; no writes; primary page target remains `https://example.com/`. | Diagnostics show primary `9222` verified as `command=check`; no `repair-actions`; final error has same run id. | PASS | duration `43ms`; clean `change_input` guidance; no proof write. | None. |
| C5 | Old adapter Chrome open, no primary | `9223` Chrome with `~/.agent-prose-replay-profile`, opened to `https://example.com/`; no `9222`. | `preflight-warm-chrome.sh launch --debug --json --run-id old-port-open-debug`; inspect both `/json/list` endpoints. | `status=ok`; launches `9222`; ignores unrelated `9223`; `launch_performed=true`; both page targets are `https://example.com/`. | Diagnostics mention only requested `9222`; no confusion with `9223`. | PASS | `9223` PID `63702`; new `9222` PID `63833`; duration `648ms`; diagnostics stayed on `9222`. | Kill both test Chromes. |
| C6 | Non-Chrome listener on primary port | HTTP server owns `9222`; no Chrome CDP. | `preflight-warm-chrome.sh launch --debug --json --run-id non-chrome-9222-debug` | Failure; no Chrome spawn; `not_real_google_chrome` or listener inspection action; no adapter fallback if wrong-browser risk applies. | Diagnostics identify `listener-detected` with `port=9222` and `listener_pid`, then the error; no command/profile leak. | PASS | Valid run must keep HTTP server alive in same shell. Latest run `occupied-9222-live`: exit `20`; `listener-detected` before `not_real_google_chrome`; `runtime_actions[0]=inspect_listener`; `no_adapter_fallback` present; duration `48ms`. | Kill HTTP server. |
| C7 | Real Chrome on primary with wrong profile | Real Chrome owns `9222` with a temporary dedicated profile, opened to `https://example.com/`, not `~/.agent-warm-profile`. | `preflight-warm-chrome.sh check --debug --json --run-id wrong-profile-debug`; inspect `/json/list`. | Exit `2`; `code=profile_mismatch`; `failure_domain=input`; `hint.action=change_input`; `runtime_actions[0]=change_input`; page target is `https://example.com/`. | Diagnostics show verified listener but redact profile path. | PASS | PID `65848`; exit `2`; duration `49ms`; clean `change_input` guidance. | Kill temporary Chrome; delete temp profile. |
| C8 | Real Chrome on primary without CDP | Real Chrome listener exists, opened to `https://example.com/`, but `/json/version` does not answer as CDP. | `preflight-warm-chrome.sh launch --debug --json --run-id chrome-no-cdp-debug` | Failure; no duplicate spawn; `runtime_actions[0]=inspect_listener`. | Diagnostics lead to inspect, not launch loop. | UNIT-COVERED | Live setup not run; hard to create faithfully without browser-level manipulation. Unit case: `preflight-warm-chrome.test.ts` test `"occupied real Chrome without CDP routes to listener inspection"`. | None. |
| C9 | Unsafe profile permissions | Isolated test profile mode set to `755`; temporary Chrome opened to `https://example.com/`. | `check`, then `repair`; inspect `/json/list`. | `check` fails with `repair_profile`; `repair` chmods and rewrites proof; page target remains `https://example.com/`. | Repair diagnostics list action names, not profile path. | PASS | `check`: exit `20`, `runtime_actions[0]=repair_profile`, `no_adapter_fallback` present. `repair`: `repair_actions=["profile_permissions","devtools_active_port"]`, final mode `700`. | Killed temp Chrome; removed temp profile. |
| C10 | Stale proof file while Chrome healthy | `9222` healthy, opened to `https://example.com/`; `DevToolsActivePort` points to `9999` and stale browser path. | `check`, then `launch`; inspect `/json/list`. | `check` succeeds without writes; `launch` rewrites proof file; page target remains `https://example.com/`. | `check` has no `repair-actions`; `launch` has `repair-actions=["devtools_active_port"]`. | PASS | `check` left stale proof intact. `launch` rewrote proof to `9222` and browser path `d8eb0251...`; duration `47ms`. | Fresh proof restored. |
| C11 | Startup URL | No `9222` listener; primary profile exists. | `launch --debug --json --run-id example-startup-url-debug`, then inspect `/json/list`. | `status=ok`; `launch_performed=true`; page target URL is `https://example.com/`. | Launch diagnostics match cold-start path; target list proves visible page. | PASS | `browser_pid=69300`; `/json/list` contained `page https://example.com/`; duration `843ms`. | Killed `9222`. |
| C12 | CDP off / no listener | No `9222` listener; no Warm Chrome process; remote debugging disabled in `chrome://inspect/#remote-debugging`. | `check --debug --json --run-id remote-debugging-off-hard-fail`. | Exit `20`; `code=endpoint_unreachable`; hint says remote debugging is off; `hint.docs_url` points to Chrome docs; `runtime_actions[0]=enable_remote_debugging`; `continuation.next_action_id=enable_remote_debugging`; `no_adapter_fallback` present. | Failure diagnostics are fast and correlated: `command-start` -> `preflight-check` -> `endpoint_unreachable`. No launch or repair diagnostics. | PASS | Final check run `remote-debugging-off-hard-fail`: duration `6ms`; hard-fail continuation; docs URL present. | None. |

## Browser Adapter Router Cases

Source: `docs/plans/2026-06-02-004-design-browser-use-adapter-router-plan.md`

Owner: Browser Adapter Router live-smoke backlog.

Use these cases to plan manual or live verification after Router runtime work.
Do not treat them as the Command Surface Alignment Proof for the flag-contract
slice; that proof lives in `browser-adapter-router.test.ts`.

### BAR-S1 Chrome DevTools manifest report

case_id: `bar-report-chrome-devtools`
kind: deterministic smoke
status: ready
run_id: `bar-report-chrome-devtools`
side_effects: check
requires: no browser; no network; `BROWSER_USE_ROUTER_EVAL_DATE=2026-06-10`

run:
- [ ] `skills/browser-use/scripts/browser-adapter-router.sh report --adapter chrome-devtools --json --run-id bar-report-chrome-devtools`

expect:
- [ ] Exit `0`
- [ ] `status=ok`
- [ ] `data.adapter_id=chrome-devtools`
- [ ] `data.report.report_source=manifest`
- [ ] `data.report.attachment_model=verified_warm_chrome`
- [ ] `data.report.capabilities` includes `snapshot_refs`, `element_actions`, and `screenshot_media` with `support=full`

cleanup:
- [ ] None.

### BAR-S2 Auto route selects fully evidenced Chrome DevTools

case_id: `bar-auto-route-chrome-devtools`
kind: deterministic smoke
status: ready
run_id: `bar-auto-route-chrome-devtools`
side_effects: check
requires: caller-assembled evidence envelope with Warm Chrome ready, Chrome DevTools attachment proof, and fresh Chrome DevTools report

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-auto-route-chrome-devtools`.

expect:
- [ ] Exit `0`
- [ ] `status=ok`
- [ ] `data.outcome=selected`
- [ ] `data.selected_adapter=chrome-devtools`
- [ ] `data.required_capabilities` matches the requested task bundle
- [ ] `runtime_actions[0].id=use_selected_browser_adapter`
- [ ] `continuation.next_action_id=use_selected_browser_adapter`
- [ ] `continuation.constraints` includes `route_validity`
- [ ] Candidate decisions include skipped non-proven adapters, not silent fallback.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-S3 Status projects the same route decision

case_id: `bar-status-same-decision`
kind: deterministic smoke
status: ready
run_id: `bar-status-same-decision`
side_effects: check
requires: same evidence envelope as `bar-auto-route-chrome-devtools`

run:
- [ ] `skills/browser-use/scripts/browser-adapter-router.sh status --envelope "$ENVELOPE" --plain --run-id bar-status-same-decision`
- [ ] `skills/browser-use/scripts/browser-adapter-router.sh route --envelope "$ENVELOPE" --json --run-id bar-status-same-decision-json`

expect:
- [ ] Plain status names `selected_adapter=chrome-devtools`
- [ ] Plain status names `action=use_selected_browser_adapter`
- [ ] JSON route returns the same selected adapter.
- [ ] No implicit latest-route or latest-proof file is read.

cleanup:
- [ ] Delete temporary envelope file.

### BAR-D1 Missing adapter proof fails closed

case_id: `bar-missing-adapter-proof`
kind: deterministic diagnostic
status: ready
run_id: `bar-missing-adapter-proof`
side_effects: check
requires: evidence envelope with `warm_chrome_ready=true`, fresh report, and no `adapter_attached_verified_browser` entry for the candidate

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-missing-adapter-proof`.

expect:
- [ ] Exit `20`
- [ ] `status=error`
- [ ] `error.code=adapter_attachment_unverified`
- [ ] `runtime_actions[0].id=prove_adapter_attachment`
- [ ] `continuation.next_action_id=prove_adapter_attachment`
- [ ] No adapter is selected from registry membership alone.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D2 Stale route evidence fails before adapter ranking

case_id: `bar-stale-route-evidence`
kind: deterministic diagnostic
status: ready
run_id: `bar-stale-route-evidence`
side_effects: check
requires: evidence envelope with `freshness.checked_at` older than `stale_after_days`; `BROWSER_USE_ROUTER_EVAL_DATE=2026-06-10`

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-stale-route-evidence`.

expect:
- [ ] Exit `20`
- [ ] `error.code=route_evidence_stale`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] No candidate ranking is used to bypass stale route evidence.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D3 Forced adapter never falls back

case_id: `bar-force-no-fallback`
kind: deterministic diagnostic
status: ready
run_id: `bar-force-no-fallback`
side_effects: check
requires: evidence envelope with `policy.mode=force`, `policy.adapter_id=agent-browser`, fresh Chrome DevTools proof/report, and no Agent Browser proof

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-force-no-fallback`.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_attachment_unverified`
- [ ] `continuation.next_action_id=prove_adapter_attachment`
- [ ] `data.selected_adapter` absent
- [ ] Chrome DevTools evidence is informational only and is not selected.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D4 Partial capability fails closed in V1

case_id: `bar-partial-capability-fail-closed`
kind: deterministic diagnostic
status: ready
run_id: `bar-partial-capability-fail-closed`
side_effects: check
requires: evidence envelope requesting `memory_debug`; Chrome DevTools report has `memory_debug` support `partial`

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-partial-capability-fail-closed`.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_capability_partial`
- [ ] `continuation.next_action_id=accept_partial_adapter`
- [ ] No success route is emitted unless a future explicit degraded-mode contract exists.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D5 Auth session precondition outranks adapter capability

case_id: `bar-auth-session-unverified`
kind: deterministic diagnostic
status: ready
run_id: `bar-auth-session-unverified`
side_effects: check
requires: evidence envelope with `task.preconditions.auth_session_required=true` and missing or false session evidence

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-auth-session-unverified`.

expect:
- [ ] Exit `20`
- [ ] `error.code=auth_session_unverified`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] No adapter capability report can make the route runnable.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D6 Mixed-run evidence fails closed

case_id: `bar-mixed-run-evidence`
kind: deterministic diagnostic
status: ready
run_id: `bar-mixed-run-evidence`
side_effects: check
requires: evidence envelope with mismatched top-level `run_id` and `preconditions.run_id`

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-mixed-run-evidence`.

expect:
- [ ] Exit `20`
- [ ] `error.code=route_evidence_mixed_run`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] No adapter selection occurs.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-S4 Prefer falls back when allowed

case_id: `bar-prefer-fallback-allowed`
kind: deterministic smoke
status: ready
run_id: `bar-prefer-fallback-allowed`
side_effects: check
requires: evidence envelope with `policy.mode=prefer`, `policy.adapter_id=agent-browser`, `fallback_allowed=true`, missing Agent Browser proof, and valid Chrome DevTools proof/report

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-prefer-fallback-allowed`.

expect:
- [ ] Exit `0`
- [ ] `data.selected_adapter=chrome-devtools`
- [ ] Candidate decisions include Agent Browser as skipped with `adapter_attachment_unverified`
- [ ] Ranking records Chrome DevTools as the selectable fallback.
- [ ] `continuation.next_action_id=use_selected_browser_adapter`

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D7 Prefer blocks fallback when disabled

case_id: `bar-prefer-fallback-disabled`
kind: deterministic diagnostic
status: ready
run_id: `bar-prefer-fallback-disabled`
side_effects: check
requires: evidence envelope with `policy.mode=prefer`, `policy.adapter_id=agent-browser`, `fallback_allowed=false`, missing Agent Browser proof, and valid Chrome DevTools proof/report

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-prefer-fallback-disabled`.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_attachment_unverified`
- [ ] `continuation.next_action_id=prove_adapter_attachment`
- [ ] Chrome DevTools appears only as informational alternative.
- [ ] No adapter is selected.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-S5 Task ranking beats registry ranking

case_id: `bar-task-ranking-wins`
kind: deterministic smoke
status: ready
run_id: `bar-task-ranking-wins`
side_effects: check
requires: evidence envelope with selectable Chrome DevTools and Playwright CDP reports; task ranks Playwright before Chrome DevTools

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-task-ranking-wins`.

expect:
- [ ] Exit `0`
- [ ] `data.selected_adapter=playwright-cdp`
- [ ] `data.ranking[0].ranking.task_priority=0`
- [ ] Registry rank does not override task priority.
- [ ] Candidate decisions include both selectable adapters.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-S6 Registry ranking breaks equal candidates

case_id: `bar-registry-ranking-tiebreak`
kind: deterministic smoke
status: ready
run_id: `bar-registry-ranking-tiebreak`
side_effects: check
requires: evidence envelope with selectable equal-confidence Chrome DevTools and Playwright CDP reports; no task adapter ranking

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-registry-ranking-tiebreak`.

expect:
- [ ] Exit `0`
- [ ] `data.selected_adapter=chrome-devtools`
- [ ] `data.ranking` orders by registry priority before confidence.
- [ ] Candidate decisions include both selectable adapters.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-S7 Explicit capability narrows bundle

case_id: `bar-extra-required-capability`
kind: deterministic smoke
status: ready
run_id: `bar-extra-required-capability`
side_effects: check
requires: evidence envelope with `task.bundle=snapshot_page_action`, `task.required_capabilities=["console_debug"]`, and Chrome DevTools full support for all resolved capabilities

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-extra-required-capability`.

expect:
- [ ] Exit `0`
- [ ] `data.required_capabilities` includes bundle capabilities plus `console_debug`
- [ ] `data.selected_adapter=chrome-devtools`
- [ ] `data.route_confidence` is the minimum confidence across the merged capability set.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D8 Unknown bundle fails closed

case_id: `bar-unknown-bundle`
kind: deterministic diagnostic
status: ready
run_id: `bar-unknown-bundle`
side_effects: check
requires: evidence envelope with an unknown `task.bundle`

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-unknown-bundle`.

expect:
- [ ] Exit `20`
- [ ] `error.code=route_evidence_invalid`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] No adapter ranking is attempted.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D9 Unknown required capability fails closed

case_id: `bar-unknown-required-capability`
kind: deterministic diagnostic
status: ready
run_id: `bar-unknown-required-capability`
side_effects: check
requires: evidence envelope with an unknown `task.required_capabilities` entry

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-unknown-required-capability`.

expect:
- [ ] Exit `20`
- [ ] `error.code=route_evidence_invalid`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] Unknown capability text is not promoted into runtime vocabulary.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D10 Missing Warm Chrome precondition fails closed

case_id: `bar-warm-chrome-not-ready`
kind: deterministic diagnostic
status: ready
run_id: `bar-warm-chrome-not-ready`
side_effects: check
requires: evidence envelope with `preconditions.warm_chrome_ready=false` and otherwise valid adapter proof/report

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-warm-chrome-not-ready`.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_attachment_unverified`
- [ ] `continuation.next_action_id=prove_adapter_attachment`
- [ ] Adapter capability report does not override missing browser-entry proof.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D11 Target origin mismatch fails closed

case_id: `bar-target-origin-mismatch`
kind: deterministic diagnostic
status: ready
run_id: `bar-target-origin-mismatch`
side_effects: check
requires: evidence envelope with `target_origin.required=true`, `expected=https://example.com`, and `observed=https://wrong.example`

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-target-origin-mismatch`.

expect:
- [ ] Exit `20`
- [ ] `error.code=target_origin_unverified`
- [ ] `error.recoverability=authenticate`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] No adapter selection occurs.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D12 Attachment model incompatible fails closed

case_id: `bar-attachment-incompatible`
kind: deterministic diagnostic
status: ready
run_id: `bar-attachment-incompatible`
side_effects: check
requires: evidence envelope with adapter proof true and report `attachment_model=separate_browser_context`

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-attachment-incompatible`.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_attachment_incompatible`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] Full action capability does not bypass incompatible attachment.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D13 Capability support none fails closed

case_id: `bar-capability-none`
kind: deterministic diagnostic
status: ready
run_id: `bar-capability-none`
side_effects: check
requires: evidence envelope requesting a capability whose report entry has `support=none`

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-capability-none`.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_capability_none`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] No degraded execution path is offered.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D14 Capability support unknown triggers research

case_id: `bar-capability-unknown`
kind: deterministic diagnostic
status: ready
run_id: `bar-capability-unknown`
side_effects: check
requires: evidence envelope requesting a capability missing from the selected report or marked `unknown`

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-capability-unknown`.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_capability_unknown`
- [ ] `runtime_actions[0].id=research_adapter_capability`
- [ ] `continuation.next_action_id=research_adapter_capability`
- [ ] No adapter is selected from missing or unknown capability data.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D15 Stale capability report triggers research

case_id: `bar-capability-stale`
kind: deterministic diagnostic
status: ready
run_id: `bar-capability-stale`
side_effects: check
requires: evidence envelope with fresh route preconditions and stale report provenance; `BROWSER_USE_ROUTER_EVAL_DATE=2026-06-10`

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-capability-stale`.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_capability_stale`
- [ ] `continuation.next_action_id=research_adapter_capability`
- [ ] Recovery includes bounded research metadata.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D16 Low-confidence full support fails closed

case_id: `bar-low-confidence-full-support`
kind: deterministic diagnostic
status: ready
run_id: `bar-low-confidence-full-support`
side_effects: check
requires: evidence envelope with `support=full` and confidence below the route threshold for a required capability

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-low-confidence-full-support`.

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_capability_unknown`
- [ ] `continuation.next_action_id=research_adapter_capability`
- [ ] Full support is not routable below confidence floor.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-S8 Media proof metadata stays browser-use-owned

case_id: `bar-media-proof-metadata`
kind: deterministic smoke
status: ready
run_id: `bar-media-proof-metadata`
side_effects: check
requires: evidence envelope with `task.media_proof.requested=true`, `run_scoped_path` set, and otherwise valid route evidence

run:
- [ ] Pipe the evidence envelope into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-media-proof-metadata`.

expect:
- [ ] Exit `0`
- [ ] `data.media_proof.owner=browser-use`
- [ ] `data.media_proof.retention=per_run`
- [ ] `data.media_proof.disclose_to_user=true`
- [ ] Diagnostics do not include raw artifact content.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-S9 Envelope path input works

case_id: `bar-envelope-file-input`
kind: deterministic smoke
status: ready
run_id: `bar-envelope-file-input`
side_effects: check
requires: valid evidence envelope written to a temporary file

run:
- [ ] `skills/browser-use/scripts/browser-adapter-router.sh route --envelope "$ENVELOPE" --json --run-id bar-envelope-file-input`

expect:
- [ ] Exit `0`
- [ ] `status=ok`
- [ ] `data.selected_adapter=chrome-devtools`
- [ ] No stdin is required.

cleanup:
- [ ] Delete temporary envelope file.

### BAR-S10 Environment envelope input works

case_id: `bar-env-envelope-input`
kind: deterministic smoke
status: ready
run_id: `bar-env-envelope-input`
side_effects: check
requires: valid evidence envelope exported as `BROWSER_USE_ROUTER_ENVELOPE_JSON`

run:
- [ ] `BROWSER_USE_ROUTER_ENVELOPE_JSON="$ENVELOPE_JSON" skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-env-envelope-input`

expect:
- [ ] Exit `0`
- [ ] `status=ok`
- [ ] `data.selected_adapter=chrome-devtools`
- [ ] No implicit latest-route file is read.

cleanup:
- [ ] Unset `BROWSER_USE_ROUTER_ENVELOPE_JSON`.

### BAR-D17 Missing envelope input fails closed

case_id: `bar-missing-envelope-input`
kind: deterministic diagnostic
status: ready
run_id: `bar-missing-envelope-input`
side_effects: check
requires: no `--envelope`, no stdin JSON, and no `BROWSER_USE_ROUTER_ENVELOPE_JSON`

run:
- [ ] `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-missing-envelope-input`

expect:
- [ ] Exit `20`
- [ ] `error.code=route_evidence_invalid`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] CLI does not block waiting for interactive terminal input.

cleanup:
- [ ] None.

### BAR-D18 Malformed JSON envelope fails closed

case_id: `bar-malformed-envelope-json`
kind: deterministic diagnostic
status: ready
run_id: `bar-malformed-envelope-json`
side_effects: check
requires: malformed JSON on stdin or in a temporary envelope file

run:
- [ ] Pipe malformed JSON into `skills/browser-use/scripts/browser-adapter-router.sh route --json --run-id bar-malformed-envelope-json`.

expect:
- [ ] Exit `20`
- [ ] `error.code=route_evidence_invalid`
- [ ] `continuation.next_action_id=change_route_input`
- [ ] Error text redacts filesystem-looking values.

cleanup:
- [ ] Delete temporary envelope file if used.

### BAR-D19 Report rejects malformed self-report override

case_id: `bar-report-malformed-self-report`
kind: deterministic diagnostic
status: ready
run_id: `bar-report-malformed-self-report`
side_effects: check
requires: malformed capability report object in `BROWSER_USE_ROUTER_SELF_REPORT_JSON`

run:
- [ ] `BROWSER_USE_ROUTER_SELF_REPORT_JSON="$BAD_REPORT" skills/browser-use/scripts/browser-adapter-router.sh report --adapter chrome-devtools --json --run-id bar-report-malformed-self-report`

expect:
- [ ] Exit `20`
- [ ] `error.code=adapter_capability_unknown`
- [ ] `continuation.next_action_id=research_adapter_capability`
- [ ] Malformed self-report does not override the manifest as routable truth.

cleanup:
- [ ] Unset `BROWSER_USE_ROUTER_SELF_REPORT_JSON`.

### BAR-S11 Valid self-report override wins over manifest

case_id: `bar-report-self-report-priority`
kind: deterministic smoke
status: ready
run_id: `bar-report-self-report-priority`
side_effects: check
requires: valid capability report object in `BROWSER_USE_ROUTER_SELF_REPORT_JSON`

run:
- [ ] `BROWSER_USE_ROUTER_SELF_REPORT_JSON="$REPORT" skills/browser-use/scripts/browser-adapter-router.sh report --adapter chrome-devtools --json --run-id bar-report-self-report-priority`

expect:
- [ ] Exit `0`
- [ ] `data.report.report_source=self_report`
- [ ] `data.report.validation=valid`
- [ ] Self-report schema validation runs before the report is emitted.

cleanup:
- [ ] Unset `BROWSER_USE_ROUTER_SELF_REPORT_JSON`.

## Browser Adapter Proof Cases

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-chrome-devtools-healthy`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-chrome-devtools-stale`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-selected-dependency-outranks-native-stale`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-mcporter-command-missing`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-mcporter-missing`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-chrome-devtools-mcp-missing`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh status --adapter chrome-devtools --port 9222 --plain --run-id bap-plain-status-smoke`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --json --run-id bap-no-explicit-port`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9333 --json --run-id bap-warm-chrome-failure-composition`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-mcporter-config-missing`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-mcporter-config-unparsable`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-list-pages-unparsable`

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
- [ ] `skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port 9222 --json --run-id bap-list-pages-empty`

expect:
- [ ] Exit `0`
- [ ] Warning includes `adapter_signal_weak`
- [ ] `continuation.next_action_id=use_verified_browser_adapter`

cleanup:
- [ ] Restore adapter fixture.

## Coverage Notes

- Live cases avoid opening the everyday default Chrome profile.
- Default-profile rejection stays unit-covered unless explicitly approved for a risky live run.
- Each case should record both stdout envelope and stderr diagnostic chain.
- Cleanup must leave no stray `9222`, `9223`, HTTP server, or temporary profile process.
- Final cleanup from latest run: no `9222`; no `9223`; no `.agent-test-*` profiles.
