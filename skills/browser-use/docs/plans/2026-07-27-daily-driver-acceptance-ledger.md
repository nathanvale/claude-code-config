# Browser Use Daily Driver Acceptance Ledger

Date: 2026-07-27

Status: active

Owner: Browser Use

## Claim

Browser Use is ready for everyday work only when the `browser-use` public front
door completes its intended workflows across supported repositories, Browser
Adapters, authentication states, and Durable Browser Knowledge.

Green requires every row to be `PASS` or deliberately `N/A`. `BLOCKED`,
`FAIL`, `PARTIAL`, and `UNASSESSED` keep the Daily Driver Acceptance Proof red.

## Proof tiers

| Tier | Meaning |
| --- | --- |
| C | Exhaustive deterministic contract proof. |
| E | Command Entrypoint Integration Test through a real process boundary. |
| H | Hermetic journey using real binaries and controlled fixtures. |
| L | Live pairwise journey against Agent Chrome. |
| G | Golden end-to-end workflow representing real everyday work. |

Rules:

- Prove every advertised Task Intent and lane decision at tier C.
- Prove every installed command path at tier E.
- Prove every failure class without personal data at tier H.
- Prove each Browser Adapter and meaningful interaction pair at tier L.
- Prove high-value day-to-day workflows at tier G.
- Record a fixture, test path, or live run receipt before marking `PASS`.
- Treat unavailable environments as `BLOCKED`, never skipped or passed.
- Treat advertised but unimplemented capability as `FAIL`.
- Invoke only `browser-use` from E, H, L, and G driver journeys.

## Status summary

Current status includes the 2026-07-27 process, clean-home installation, and
deterministic-routing harvest, plus the 2026-07-27 ledger gap audit: verdict
corrections (front-door driver rule, blocked-vs-fail integrity), 52 admitted
candidate rows (UNASSESSED), and an appendix of deferred candidates. The
2026-07-27 convergence fan-out (steps 1-3, 5, 6) harvested 33 rows, and the
follow-up E-tier spawn wave closed the 11 process-boundary gaps with additive
spawned-CLI tests: net 28 PASS, 4 PARTIAL (L-tier live halves or the A21
delivery decision), 1 FAIL (G17 exit-code classification, owner decision
open). The 2026-07-27 tier-L live wave (serialized Agent Chrome, front-door
driver rule enforced) refreshed 16 rows: C01/C02/C03/C05/H21 PASS live;
D07/D10 BLOCKED behind the chrome-devtools-mcp 1.5.0 operator gate; the
remaining PARTIALs are now resolved for the Browser Target Discovery gap:
the agent-browser lane grew its own CLI-subcommand discovery transport
(`<probe> --cdp <ws> --session browser-use-<run> tab list --json`), so
handoff-bound `targets list --adapter agent-browser` emits operation-ready
candidates live (D01/D26/D27 flipped PARTIAL->PASS 2026-07-28; port 9231,
agent-browser 0.31.2, real Chrome 150, loopback fixture on 8912). The
read-only-baseline gap is now closed: the 2026-07-28 live mutating-intent wave (port 9231, agent-browser
0.31.2, real Chrome 150, loopback fixture) flipped D06/D09/D12/D13 PARTIAL->PASS
— observe-mutate-verify confirms from fresh structure (D06), an unresolved
semantic target refuses before mutation (D09), verification-unavailable becomes
external_effect unknown with retryable false (D12), and a false named
postcondition is not overridden by ambient success text (D13). Lifecycle scope
is now deliberate: operator-owned stop setup, one fixed `agent-chrome/default`
identity, and no remote-debugging-off product mode.
The 2026-07-28 P0 safety wave closed F26 with cross-owner contract/hermetic
proof; implemented Playwright observe-mutate-verify and stale-ref refusal at
unit, public-driver, and spawned-process tiers; and added a real SIGKILL
confidential-delivery containment proof. D08/D11 now wait as BLOCKED, not FAIL,
on the operator-gated pinned Playwright adapter install. F06/F18 remain PARTIAL
until a public live confidential-delivery path exists; their C/H tiers were
strengthened again 2026-07-28 with wired-seam runbook-delivery coverage
(`browser-use-runbook.test.ts` +5 C-tier, `browser-use-confidential-delivery-seam.test.ts`
+1 H-tier, `confidential-runbook-delivery-fixture.ts` smoke), and
`runtime/browser-use-security/` now exists as a repo-level scaffold (admission
manifest `src/admission.ts` + `tests/admission.test.ts`, entitlements, Xcode
project, and unsigned target sources ApprovalBroker /
ConfidentialFieldDeliveryXPC / TokenRetrievalLauncher). It is still not
admissible until Apple-signed, so no tier-L/G verdict flips: native custody
stays absent behind the operator gate (Apple signing U04, 1Password U05,
Keychain enrollment U06).

| Verdict | Count |
| --- | ---: |
| PASS | 58 |
| PARTIAL | 54 |
| FAIL | 25 |
| BLOCKED | 7 |
| UNASSESSED | 79 |
| N/A | 2 |

| Status | Meaning |
| --- | --- |
| PASS | Current fixture-backed or live evidence proves the criterion. |
| PARTIAL | Some required tiers or interaction pairs are proven. |
| FAIL | Current behavior contradicts the criterion or capability is missing. |
| BLOCKED | Required external environment or authority is unavailable. |
| UNASSESSED | No verdict has been harvested yet. |
| N/A | Deliberately outside the supported product claim, with rationale. |

## A. Front door, distribution, and discovery

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-A01 | No-arg invocation launches a compact next-action guide. | C,E | PASS | `src/browser-use-front-door.test.ts`; unrelated-repository process proof in `scripts/command-entrypoint.integration.test.ts`. |
| DDA-A02 | Root help exposes every public family and no secondary CLI dance. | C,E | PASS | Exhaustive contract test plus root-help process proof. |
| DDA-A03 | Version-matched guide renders core, recovery, auth, and lanes topics. | C,E | PASS | All four topics render through the real process boundary. |
| DDA-A04 | Every leaf usage names the `browser-use` executable. | C,E | PARTIAL | Exhaustive in-process test exists; process proof missing. |
| DDA-A05 | Unknown family and leaf errors identify the safe invalid token. | C,E | PASS | In-process and unrelated-repository process proofs cover both error levels. |
| DDA-A06 | Success data stays on stdout and diagnostics stay on stderr. | C,E | PASS | Entrypoint process assertions cover launcher, guide, discovery, and usage errors. |
| DDA-A07 | JSON output parses without scraping human text. | C,E | PASS | Source and clean-home installed process proofs parse envelopes directly. |
| DDA-A08 | Help and guide stay inside fixed line and byte budgets. | C,E | PARTIAL | Line budgets exist; proposed byte budget ≤ 8192 bytes per topic; process proof missing. |
| DDA-A09 | Installed `browser-use` resolves from an unrelated repository. | E,G | PARTIAL | Clean-home and live `/tmp` PATH proof pass; golden workflow remains. DDA-G02 owns the product-repository journey — this row owns PATH resolution shape. |
| DDA-A10 | Installed `browser-use` resolves from a temporary empty directory. | E,H | PASS | `runtime/setup/tests/setup-domains.integration.test.ts` installs then invokes from a clean temporary root. Same journey as DDA-G03 — counted once. |
| DDA-A11 | Source, built, and packed CLI render equivalent discovery. | E,H | UNASSESSED | Build passes reported; parity journey missing. |
| DDA-A12 | Packed CLI lists shipped runbooks without the source checkout. | E,H | UNASSESSED | Build copies catalog; installed journey missing. |
| DDA-A13 | Missing private connection dependency returns typed recovery, not crash. | E,H | UNASSESSED | PR 263 claim needs process evidence. |
| DDA-A14 | Setup status detects and repairs a missing `browser-use` PATH entry. | E,H | PASS | Bin-topology unit proof, clean-home integration proof, and live check/apply/check receipt. |
| DDA-A15 | Version drift between source, dist, and package metadata fails a check. | C,E | UNASSESSED | No acceptance evidence mapped. |
| DDA-A16 | Paths containing spaces do not break invocation or artifacts. | E,H | UNASSESSED | Fixture journey missing. |
| DDA-A17 | Read-only current directories do not break read-only discovery. | E,H | UNASSESSED | Fixture journey missing. |
| DDA-A18 | Symlinked repository and worktree paths preserve command identity. | E,H | UNASSESSED | Fixture journey missing. |
| DDA-A19 | Unknown flag on a valid leaf fails with a typed usage error naming the flag. | C,E | PASS | browser-use-anti-drift.test.ts: parser throws naming --bogus (C); in-process and spawned `task list --bogus` both exit 2 usage_error naming the flag (E). |
| DDA-A20 | Every command string printed by the guide is accepted by the parser. | C | PASS | browser-use-anti-drift.test.ts: every guide-printed command line (all topics plus --full, placeholders substituted) parses with zero rejects. |
| DDA-A21 | Missing or wrong-version Bun runtime yields actionable guidance, not a raw exec error. | E,H | PARTIAL | browser-use-bun-preflight.test.ts: the launcher shim under a bun-stripped PATH emits a named remedy at exit 2 vs the raw env exit-127 baseline, and execs bun faithfully when present. Gap: the installed bin still symlinks the .ts entry directly — wiring the shim changes the A14 delivery contract. |
| DDA-A22 | Duplicate or shadowing `browser-use` binaries on PATH are detected by `setup status`. | E,H | PASS | runtime/setup/tests/bin-shadow.test.ts: inspectBinTopology emits `bin_shadowed` naming shadow path and owned destination (H); spawned real `setup status --json` with a fixture shadow earlier on PATH surfaces the advisory naming both paths, later-on-PATH stays silent (E). Src: detectShadowingBins. |
| DDA-A25 | Non-TTY and NO_COLOR stdout contains zero ANSI escapes in JSON and plain modes. | C,E | UNASSESSED | Oracle: piped process capture, byte-scan for ESC. IDs A23-A24 reserved for appendix candidates. |

## B. Task Intent routing and lane admission

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-B01 | `task list` exposes every code-owned Task Intent exactly once. | C,E | PASS | Contract and unrelated-repository process proofs report ten unique intents. |
| DDA-B02 | `lanes list` exposes every registered Browser Adapter exactly once. | C,E | PASS | Registry and unrelated-repository process proofs report three unique lanes. |
| DDA-B03 | Lane discovery reports implementation, integrity, and evidence truthfully. | C,L | PARTIAL | Current projection is honest; live evidence is unproven. |
| DDA-B04 | Every Task Intent deterministically selects its declared preferred lane; an unavailable implementation names that exact lane. | C | PASS | Exhaustive table in `src/browser-use-task-run.test.ts`; Playwright names `playwright-cdp` and fails closed. |
| DDA-B05 | Every Agent Browser intent executes through `agent-browser`. | C,L | PARTIAL | Some task and live action evidence exists. |
| DDA-B06 | Every Playwright intent executes through `playwright-cdp`. | C,L | FAIL | Frontend-test and locator/ARIA now have deterministic execution; trace inspection and HTTP replay plus live proof remain. |
| DDA-B07 | Every Chrome debugging intent executes through `chrome-devtools-mcp`. | C,L | PARTIAL | Executor tests exist; full live intent set missing. |
| DDA-B08 | An admissible explicit lane override is honored and reported. | C,L | UNASSESSED | Map existing tests and add live pair. |
| DDA-B09 | An inadmissible explicit lane override fails before dispatch. | C,H | PARTIAL | Capability-policy tests exist; public journey missing. |
| DDA-B10 | An unknown or rejected lane alias fails closed. | C,E | PARTIAL | Registry tests exist; process proof missing. |
| DDA-B11 | Unproven task evidence never authorizes execution. | C,H | UNASSESSED | Current lanes are unproven; acceptance journey missing. B11-B13 form one parameterized evidence gate (unproven/stale/drifted) sharing one fixture family. |
| DDA-B12 | Stale evidence never authorizes execution. | C,H | PARTIAL | Registry unit tests exist; public journey missing. |
| DDA-B13 | Drifted integrity never authorizes execution. | C,H | PARTIAL | Registry unit tests exist; public journey missing. |
| DDA-B14 | No routing failure silently falls back to another adapter. | C,H,L | PARTIAL | Policy tests exist; pairwise live failure missing. |
| DDA-B15 | Selected lane and evidence digest appear in the run result. | C,L | UNASSESSED | Map shared-run projection evidence. |
| DDA-B16 | Sequential tasks can swap Agent Browser to Chrome DevTools safely. | H,L,G | UNASSESSED | Live journey missing. Safely = fresh envelope validation per swap, no shared session state, fresh observation post-swap. |
| DDA-B17 | Sequential tasks can swap Chrome DevTools to Playwright safely. | H,L,G | BLOCKED | Both execution paths exist; live same-tab swap proof blocked on the operator-gated pinned adapter install. Safely = fresh envelope validation per swap, no shared session state, fresh observation post-swap. |
| DDA-B18 | Adapter swaps preserve the intended Warm Chrome environment and tab. | H,L,G | UNASSESSED | Pairwise live journey missing; add a mock-transport swap fixture at H before the operator gate opens. |
| DDA-B19 | A terminal `unknown` outcome blocks retry and adapter switching. | C,H | PARTIAL | Run-model proof exists; public journey missing. |
| DDA-B20 | Lane conformance evidence can move from unproven to proven mechanically. | C,H,L | FAIL | All lanes currently expose unproven evidence; production probe path absent from acceptance. Prerequisite: a front-door conformance producer command — not exercisable through `browser-use` alone today. |
| DDA-B21 | Test-seam env vars are inert outside their declared scope. | C,E | PASS | browser-use-sec-seams.test.ts: in-process byte-identical proof (C) plus spawned real-CLI pairs for task/lanes list with seams set vs unset — identical normalized stdout/stderr and exit at the process boundary (E). |
| DDA-B23 | `trace-inspection` returns typed-unavailable naming the missing artifact contract. | C,E | PASS | browser-use-typed-unavailable-intents.test.ts: trace-inspection refuses `intent_unrouted` naming the trace artifact contract with await_intent_lane continuation and zero lane dispatch, in-process (C) and spawned with a verified-handoff fixture (E). Src: intent short-circuit in browser-use-task-run.ts. |
| DDA-B24 | `http-replay` returns typed-unavailable naming the archive-input contract. | C,E | PASS | browser-use-typed-unavailable-intents.test.ts: http-replay names the archive-input contract with the identical typed-unavailable class to DDA-B23, in-process (C) and spawned (E). |
| DDA-B25 | A hanging adapter is bounded by the command timeout and leaves no orphan process or session. | H | PASS | browser-use-process-hygiene.test.ts: a real sleep-forever binary is bounded by the transport timeout plus the 2 s kill grace with an empty process tree; a scripted-timeout driver journey exits 20 `task_run_connection_unstable` with terminal run state. |

## C. Browser entry and connection

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-C01 | No existing Agent Chrome triggers one proven cold launch. | H,L | PASS | Live 2026-07-27: with no Agent Chrome present, one front-door `task run` probed the port (endpoint_unreachable), performed exactly one cold launch, and produced a fresh agent-warm-profile Chrome (receipt in TEST_MATRIX). Decision browser-use-front-door-003 keeps stop and fixture teardown operator-owned: Warm Chrome is reusable, and listener ownership does not grant safe termination authority. |
| DDA-C02 | Healthy Agent Chrome is reused without another launch. | H,L | PASS | Live 2026-07-27: repeated front-door `task run` against a healthy Agent Chrome reported launch.launched=false and environment agent-chrome on every attach; Chrome PID stable, no new process. |
| DDA-C03 | Human Chrome is never selected as a fallback. | C,H | PASS | Live 2026-07-27: with a human default-profile Chrome running simultaneously on 9222, every front-door run selected environment agent-chrome; the human listener was only ever refused (foreign_listener), never selected. |
| DDA-C04 | A wrong profile fails before adapter action. | H,L | N/A | Decision browser-use-front-door-004 fixes v1 to Browser Connect identity `agent-chrome/default`; Warm Chrome owns the physical profile path, so no public wrong-profile request exists. The adjacent safety invariant remains proven live: a human-profile listener fails closed as `foreign_listener` before adapter action. |
| DDA-C05 | A foreign listener produces one bounded Repair Path. | H,L | PASS | Live 2026-07-27: a dummy TCP listener on the agent CDP port yielded exactly one bounded typed Repair Path (foreign_listener, exit 20, retryable=false, next_action use_suggested_port), one attempt, no retry storm; a healthy run recovered after the listener was killed. |
| DDA-C06 | Remote debugging disabled produces actionable blocked evidence. | H,L | N/A | Decision browser-use-front-door-005 defines Agent Chrome by a verified CDP endpoint; remote-debugging-off removes the product capability rather than selecting a supported mode. The external-fault boundary remains covered by bounded typed `launch_failed` evidence: one attempt, operator inspection, no orphan. |
| DDA-C07 | Missing adapter binary returns typed installation recovery. | H,L | PARTIAL | Browser Connect tests exist; public-front-door journey missing. |
| DDA-C08 | Adapter version mismatch fails before attachment. | H,L | PARTIAL | Browser Connect tests exist; public-front-door journey missing. |
| DDA-C09 | A stale handoff cannot authorize a task. | C,H | PARTIAL | Consumer validation tests exist; process journey missing. |
| DDA-C10 | Browser restart invalidates old attachment and supports fresh mint. | H,L | UNASSESSED | Journey missing. |
| DDA-C11 | A caller cannot inject a convention endpoint. | C,H | PARTIAL | Contract tests exist; public journey missing. |
| DDA-C12 | Multiple Warm Chrome environments never cross identity. | H,L | UNASSESSED | Multi-environment fixture and live journey missing; G deferred. |
| DDA-C13 | Connection failure preserves Browser Connect exit and Repair Path verbatim. | C,E,H | PARTIAL | Mint seam tests exist; process proof missing. |
| DDA-C14 | Internal mint and caller-managed handoff use one validation path. | C,H | PARTIAL | Unit coverage exists; fixture journey missing. |
| DDA-C15 | Fresh task execution auto-mints; run resume requires its original handoff. | C,E,H | PARTIAL | Parser and mint tests exist; process journey missing. |
| DDA-C16 | Unknown envelope contract id or schema version is refused with typed upgrade guidance. | C,H | PASS | browser-use-sec-seams.test.ts: schema_version '3' handoff refused exit 20 `target_discovery_handoff_invalid` naming found 3 and pinned 2; zero spawns. |
| DDA-C17 | An envelope whose endpoint host is not loopback is refused before any adapter dispatch. | C,H | PASS | browser-use-sec-seams.test.ts: LAN, public, and link-local endpoints refused pre-dispatch with zero spawns; loopback controls still spawn. Guard: isLoopbackHost in readHandoffFacts. |
| DDA-C18 | A tampered envelope fails validation closed. | C,H | PASS | browser-use-sec-seams.test.ts: deterministic stride-3 byte sweep plus 19-case field battery; every invariant-changing mutant refused with the one code `target_discovery_handoff_invalid`. |
| DDA-C19 | TTL decisions are clock-jump safe; ambiguous clock fails closed. | C,H | UNASSESSED | Oracle: fixture state with future mtime or jumped clock — refusal or re-mint, never acceptance. |

## D. Targets, operations, and continuity

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-D01 | Targets list returns operation-ready candidates only when handoff-bound. | C,L | PASS | Live 2026-07-28 (WARM_CHROME_CDP_PORT=9231, agent-browser 0.31.2, real Chrome 150, loopback fixture on 8912): `browser-use targets list --mode handoff-bound --adapter agent-browser --json` auto-mints the Verified Handoff Envelope and emits operation-ready candidates — status ok, operation_ready true, candidate_count 1, candidate ordinal 1 origin `http://127.0.0.1:8912` (R32-redacted, no path), run_id dcbf5e75-78fa-4b31-8596-9992eaf48a58, handoff_evidence_id 6092f7a42dd638eba6acaa4e0de8810a, 361ms, exit 0, no browser-connect. The agent-browser lane now has its own CLI-subcommand discovery transport (`<probe> --cdp <ws> --session browser-use-<run> tab list --json`), distinct from the chrome-devtools-mcp `list_pages` mcporter call; the fail-closed gate stays intact (playwright-cdp still refuses, chrome still passes). |
| DDA-D02 | Target selection resolves the intended tab, not adapter default state. | C,L | PASS | U6-ET3 live evidence. |
| DDA-D03 | Snapshot observes the selected target. | C,L | PASS | U6-ET3 and PAC evidence. |
| DDA-D04 | Screenshot writes a bounded run artifact. | C,L | PASS | U6-ET4 live evidence. |
| DDA-D05 | Viewport emulation applies only on a capable lane. | C,L | PARTIAL | Unit operation tests exist; live evidence missing. |
| DDA-D06 | Agent Browser observe-mutate-verify confirms fresh structure. | L | PASS | Live 2026-07-28 (WARM_CHROME_CDP_PORT=9231, agent-browser 0.31.2, real Chrome 150, loopback fixture 127.0.0.1:8912): `browser-use task run --intent routine-automation --click-role button --click-name Save --postcondition-id saved --expect-visible "[data-persisted='true']" --tab t1 --allowed-origin http://127.0.0.1:8912 --json` -> status ok, selected_lane agent-browser, run confirmed, mutation_dispatched true, executed_steps 2 (snapshot+click), external_effect none, postcondition saved confirmed from fresh `[data-persisted='true']` visibility, handoff_evidence_id aa347b34d6c30bda… (auto-minted, no browser-connect). Backed by the hermetic front-door proof (exactly-one resolution, write-ahead dispatch, refuse-before-mutation on zero/multiple/drift/invalid-selector). |
| DDA-D07 | Chrome DevTools observe-mutate-verify confirms fresh structure. | L | BLOCKED | Live 2026-07-27: typed fail-closed refusal adapter_not_installed — chrome-devtools-mcp 1.2.0 cached vs pinned 1.5.0, install is operator-gated (requires_operator, no_pin_policy_change). Joins the B17/J03/J09 operator gate. |
| DDA-D08 | Playwright observe-mutate-verify confirms fresh structure. | L | BLOCKED | Implementation and process tiers pass: `browser-use-playwright-task.test.ts`, `browser-use-task-run.test.ts`, and `browser-use-platform-process-boundary.test.ts` prove fresh snapshot resolution, write-ahead dispatch, one click, fresh named visibility, false-postcondition refusal, and unknown-on-verification-loss. Live 2026-07-28 gate: `repair-adapter playwright-cdp --check` reports pinned 0.1.17 absent, lifecycle scripts required, requires_operator, no_pin_policy_change. |
| DDA-D09 | Agent Browser stale refs cannot prove a mutation. | L | PASS | Live 2026-07-28 (port 9231, agent-browser 0.31.2, real Chrome 150, fixture 127.0.0.1:8912 with Save/Cancel buttons): a semantic target absent from the current snapshot (`--click-role button --click-name Submit`) refuses before any click -> exit 20, lane_outcome agent_browser_ref_invalid, "The semantic click target did not resolve to exactly one ref in the current task-local snapshot", external_effect none, no mutation dispatched. The exactly-one rule holds: a ref whose current semantics differ cannot cross the mutation boundary. Backed by the hermetic snapshot-local resolution + fresh-structure verify proof. |
| DDA-D10 | Chrome DevTools stale refs cannot prove a mutation. | L | BLOCKED | Live 2026-07-27: chrome-devtools-mcp lane cannot execute under the version pin (1.2.0 vs pinned 1.5.0, operator-gated install); additionally the front-door baseline is read-only with a fresh handoff per run, so no stale ref crosses a front-door boundary. |
| DDA-D11 | Playwright stale locators cannot prove a mutation. | L | BLOCKED | Hermetic and public-driver proofs now show zero/duplicate/stale semantic matches refuse before the write-ahead marker with no click, no external effect, and no confirmed run; click uncertainty becomes terminal unknown after exactly one dispatch. Live stale-locator proof shares D08's operator-gated pinned adapter install. |
| DDA-D12 | Ambiguous external effect becomes `unknown` and is not repeated. | H,L | PASS | Live 2026-07-28 (port 9231, agent-browser 0.31.2, real Chrome 150, fixture 127.0.0.1:8912): a dispatched Save click whose postcondition selector cannot be freshly proven (`--expect-visible "#does-not-exist-at-all"`) -> exit 20, lane_outcome agent_browser_mutation_effect_unknown, external_effect unknown, error task_run_effect_unknown, retryable false, next_action inspect_task_run_result (never retry) — run_id 2616f9f4…. The no-repeat property holds structurally (retryable false + terminal unknown; hermetic proof asserts exactly one click and terminal-truth resume refusal, CAS-persisted dispatch across the crash window). |
| DDA-D13 | Conflicting ambient text cannot override the named postcondition. | H,L | PASS | Live 2026-07-28 (port 9231, agent-browser 0.31.2, real Chrome 150, fixture 127.0.0.1:8912 whose DOM contains the ambient text "Saved successfully" plus a present-but-hidden `[data-decoy='true']`): a Save click with a false named postcondition (`--expect-visible "[data-decoy='true']"`, an element that exists but stays hidden) -> exit 20, lane_outcome agent_browser_postcondition_not_achieved, "Fresh structure did not satisfy the declared mutation postcondition", external_effect unknown (conservative post-dispatch truth), run_id bf527282…. The ambient "Saved successfully" text never reached stdout (leak count 0): only the named structural postcondition governs success. |
| DDA-D14 | Closing the active tab during a run yields typed recovery. | H,L | UNASSESSED | Journey missing. |
| DDA-D15 | Popup and new-tab flows bind refs to the correct tab. | H,L | UNASSESSED | Journey missing. |
| DDA-D16 | Iframe interaction preserves ref and origin boundaries. | H,L | UNASSESSED | Journey missing. |
| DDA-D17 | Alert, confirm, prompt, and beforeunload states do not deadlock runs. | H,L | UNASSESSED | Journey missing. |
| DDA-D18 | SPA rerender invalidates stale refs and supports a fresh observation. | H,L | UNASSESSED | Fixture journey missing. |
| DDA-D19 | Cross-origin redirects remain inside declared origin policy. | H,L | UNASSESSED | Fixture journey missing. |
| DDA-D20 | Upload and download actions keep file paths bounded. | H,L | UNASSESSED | Fixture journey missing. Includes download sub-oracle: downloads land only under the bounded artifact root or are refused. |
| DDA-D21 | Unicode, multiline, and keyboard-composition input stays exact. | H,L | UNASSESSED | Fixture journey missing. |
| DDA-D22 | Long-running pages use bounded waits and timeouts. | H,L | UNASSESSED | Fixture journey missing. Bound: every wait carries an explicit timeout; proposed default ≤ 30 s. |
| DDA-D23 | Output truncation and content boundaries prevent context flooding. | C,H,L | UNASSESSED | Agent Browser supports knobs; Browser Use journey missing. |
| DDA-D24 | Prompt-shaped page content remains untrusted data. | H,L | UNASSESSED | Adversarial fixture journey missing; G deferred until the H fixture ladder exists. |
| DDA-D25 | Action confirmation policy gates externally visible mutation. | H,L,G | UNASSESSED | End-to-end journey missing. |
| DDA-D26 | Zero open pages returns empty candidates plus a typed continuation, never a crash. | H,L | PASS | Hermetic PASS (browser-use-target-realism.test.ts) plus live 2026-07-28: Agent Chrome reduced to zero page targets (out-of-band CDP `/json/close` cascade; CDP still alive on 9231), then `browser-use targets list --mode handoff-bound --adapter agent-browser --json` returned the exact named oracle — exit 20, `target_discovery_no_candidates` ("No Browser Target Candidates were discovered through the attached adapter."), continuation `open_browser_target`, run_id 757e03b4-1a6c-480e-80af-7a555f8e67d1, 520ms, stderr no stack trace = never a crash. Agent Chrome restored to a fixture tab afterward; post-restore discovery green (candidate_count 1). The agent-browser discovery transport now reaches this continuation live (see DDA-D01). |
| DDA-D27 | Hundreds of tabs stay within the output budget and hint selection still resolves. | H,L | PASS | Hermetic PASS (300-target fixture) plus live 2026-07-28: 7 real loopback tabs on 9231 (fixture on 8912), `browser-use targets list --mode handoff-bound --adapter agent-browser --show-url --json` stayed bounded and typed — status ok, operation_ready true, candidate_count 7, dense ordinals [1..7], R32 redaction intact (each candidate origin `http://127.0.0.1:8912`, path_shape `/ […]`, query stripped), handoff_evidence_id cbea1f32311dddc8fb162715615ee69f, 285ms, exit 0. The candidate-projection half now runs live through the agent-browser CLI-subcommand discovery transport (see DDA-D01). Note: `--url-contains` is a `targets select` flag, not a `targets list` flag; listing exposes `--show-url`. |
| DDA-D28 | Service workers, extension pages, devtools, and `chrome://` targets never appear operation-ready. | C,H | PASS | browser-use-target-realism.test.ts: mixed CDP listing admits only http(s) page targets; fixed a real defect (service_worker with an https url was admitted) via RawPage.type preservation and a type filter in discovery. |
| DDA-D29 | Page-controlled strings are sanitized; control chars and ANSI escapes never reach stdout raw. | C,H | PASS | browser-use-sec-seams.test.ts: ESC/CSI/BEL/DEL/0x9b title leaves zero raw control bytes on stdout; stripControlChars wired into redactTitle (browser-use-core.ts). |
| DDA-D30 | IDN and punycode hosts render unambiguously; origin checks compare canonical forms. | C,H | PASS | browser-use-target-realism.test.ts: unicode and xn-- forms project to one canonical ascii origin and origin hints in either spelling compare equal. |
| DDA-D31 | `file://`, `about:`, and `chrome://` schemes in allowed origins are admitted or refused by explicit rule. | C,H | PASS | browser-use-target-realism.test.ts: 10-case scheme table plus an end-to-end listing prove http(s)-only admission over file/about/chrome/devtools/extension/ws/data/javascript. |
| DDA-D33 | Rate-limit and captive-portal interstitials produce typed not-achieved, never retry storms. | H | PASS | browser-use-target-realism.test.ts: loopback 429 yields typed `target_discovery_transport_failed` with exactly one request and one adapter invocation — no retry storm. |
| DDA-D34 | Proxy env vars never reroute loopback CDP traffic. | C,H | UNASSESSED | Oracle: `HTTPS_PROXY` at a black hole — live-path fixture still connects direct. |

## E. Browser Runbook and Durable Browser Knowledge lifecycle

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-E01 | Shipped runbooks list from the installed package. | E,H | PASS | Clean-home installation invokes `browser-use runbook list` and finds the shipped catalog. |
| DDA-E02 | Repository-owned runbooks list from an unrelated repository. | E,H,G | FAIL | No public repository discovery journey. |
| DDA-E03 | Shipped and repository runbook precedence is deterministic. | C,H | UNASSESSED | Contract and fixture missing. |
| DDA-E04 | `runbook show` validates one exact service and flow. | C,E | PARTIAL | Tests exist; process proof missing. |
| DDA-E05 | A user or agent can create a draft Browser Runbook through `browser-use`. | C,E,H | FAIL | No create command exists. Golden lifecycle owned by DDA-J05. |
| DDA-E06 | Draft validation rejects secrets and invalid origins. | C,H | FAIL | No public authoring path exists. |
| DDA-E07 | Exactly one runbook version can be active for a flow. | C,H | FAIL | Activation authoring surface missing. |
| DDA-E08 | A prior valid runbook version can be rolled back safely. | C,H,G | FAIL | Rollback surface missing. |
| DDA-E09 | Declared runbook inputs bind exactly once and redact sensitive values. | C,H,L | PARTIAL | Input tests exist; full confidential journey missing. |
| DDA-E10 | Runbook origins constrain every navigation and mutation. | C,H,L | PARTIAL | Compiler tests exist; live adversarial journey missing. |
| DDA-E11 | Fresh `runbook run` internally attaches Agent Browser. | C,E,L | PARTIAL | Mint tests exist; live public-front-door journey missing. |
| DDA-E12 | Auth-bound runbook execution resumes after approved auth. | H,L,G | FAIL | Native auth capability absent. |
| DDA-E13 | Selector drift follows the coded heal ladder or blocks honestly. | H,L,G | UNASSESSED | Fixture journey missing. Prerequisite: runbook-mode execution. |
| DDA-E14 | Recorder JSON can be paired, validated, and replayed without secrets. | C,H,L | FAIL | Public deterministic-mode lifecycle missing. |
| DDA-E15 | Run Outcome records confirmed, not-achieved, unknown, and value metrics. | C,H,G | PARTIAL | Schema exists; full workflow evidence missing. |
| DDA-E16 | Browser capture can promote selected Scratch Evidence into a runbook or gotcha. | H,G | FAIL | Public capture workflow missing. |
| DDA-E17 | Runbook schema migration preserves active flow identity. | C,H | UNASSESSED | Migration fixtures do not yet prove authoring lifecycle. |
| DDA-E18 | Concurrent authoring cannot activate two current versions. | C,H | FAIL | Authoring and activation surface missing. |
| DDA-E19 | A runbook with an unknown schema version fails typed with migration guidance. | C,H | UNASSESSED | Oracle: version-bumped fixture — typed refusal. |
| DDA-E20 | A corrupt runbook file fails closed naming the file. | C,H | UNASSESSED | Oracle: truncated fixture — typed error with path, no stack trace. |
| DDA-E21 | Hostile runbook content is refused at load, not only at authoring. | C,H | UNASSESSED | Oracle: hand-authored hostile runbook (out-of-policy origins, secret-shaped values) — show and run refuse with typed per-finding report. |

## F. Authentication and security

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-F01 | Auth readiness reports operational, blocked, or absent truthfully. | C,E | PARTIAL | Auth command tests exist; native capability absent. |
| DDA-F02 | A service resolves exactly one approved Item Binding. | C,H,G | PARTIAL | Binding model tests exist; live path missing. |
| DDA-F03 | Ambiguous binding requires a signed one-use selection grant. | C,H,G | PARTIAL | Candidate projection tests exist; signing owner absent. |
| DDA-F04 | Moved, forbidden, or revoked items return typed repair without rescan. | C,H | PARTIAL | Model tests exist; live vault journey missing. |
| DDA-F05 | Raw credentials reach only disposable secret helpers. | C,H,L | PARTIAL | Leak and confidential-delivery tests exist; native live proof missing. |
| DDA-F06 | No password, OTP, cookie, token, or auth URL reaches output or artifacts. | C,H,L,G | PARTIAL | C/H strengthened and now wired-seam: `src/browser-use-confidential-field-delivery-leak.test.ts` (3 tests / 29 expect), `src/browser-use-confidential-delivery-seam.test.ts` (12 tests / 100 expect, +1 wired H-tier over the prior 11/79), and `src/browser-use-confidential-delivery-interruption.test.ts` (1 test / 6 expect) sweep success, helper crash, later failure, real run-store bytes, stdout/stderr, and a SIGKILL temp tree with negative leak controls. New runbook-delivery wired-seam coverage lands the confidential path through the real runbook executor: `src/browser-use-runbook.test.ts` (38 tests / 104 expect, +5 wired C-tier over the prior 33) backed by `src/fixtures/confidential-runbook-delivery-fixture.ts` (standalone smoke exit 0, journal [quarantine:raised, lease:acquired:oncore_password, op-execute:secret-acquired, delivery:bounded-write, cleanup:released], run.json sentinel count 0) and the runtime wiring in `src/browser-use-runbook.ts` / `src/browser-use-runtime.ts` proven by `src/browser-use-runtime-security-wiring.test.ts`. Full `skills/browser-use/src` suite 63 files / 1298 tests / 7676 expect / exit 0; tsc_check errorCount 0; biome clean on the new specs and fixture. Public-front-door receipt 2026-07-28, run `1a6aa68d-825e-47ad-82af-0252697d2a6e`: `browser-use auth enroll-browser-automation-token --json` returned `native-capability-absent` with continuation `acquire-native-capability`; the signed Browser Use Security product is absent, so no public live auth workflow can begin. Tier L (and tier G) stay PARTIAL behind the native-product-absent operator gate (Apple signing U04, 1Password U05, Keychain enrollment U06). Owns live auth workflow leakage; scan-harness coverage owned by DDA-I09. |
| DDA-F07 | Authenticated Session Reuse works across supported adapters. | H,L,G | FAIL | No lane advertises an auth method. Root cause shared with DDA-F16. |
| DDA-F08 | Session Identity Proof confirms expected subject, account, and tenant. | H,L,G | FAIL | End-to-end proof owner not operational. |
| DDA-F09 | Wrong account or tenant stops before mutation. | H,L,G | FAIL | End-to-end journey missing. |
| DDA-F10 | Expired login state routes to auth repair, not adapter fallback. | H,L,G | UNASSESSED | Journey missing. |
| DDA-F11 | MFA routes to bounded user presence and resumes the same run. | H,L,G | FAIL | Native auth and user-presence path incomplete. |
| DDA-F12 | Current OTP retrieval respects expiry and attempt budgets. | C,H,L | PARTIAL | Auth transaction tests exist; live proof missing. |
| DDA-F13 | Human Identity Attestation is one-run and cannot override mismatch. | C,H,G | PARTIAL | Model proof needs public journey. |
| DDA-F14 | Credential rotation invalidates stale binding evidence cleanly. | H,L,G | UNASSESSED | Live vault journey missing. |
| DDA-F15 | Account lockout risk stops automatic retry. | C,H,G | UNASSESSED | Failure fixture missing. |
| DDA-F16 | Browser Automation token custody and vault grant can become operational. | H,L,G | FAIL | Commands report native-capability-absent state. Root cause shared with DDA-F07. |
| DDA-F17 | Each supported lane advertises only proven auth methods. | C,H,L | PARTIAL | Honest empty lists today; operational conformance missing. |
| DDA-F18 | Confidential delivery interruption leaves no secret-bearing durable state. | C,H,L | PARTIAL | `src/browser-use-confidential-delivery-interruption.test.ts` (1 test / 6 expect) drives a real child to the confidential helper with a derived password sentinel, parent sends SIGKILL, then scans stdout, stderr, runtime/state roots, and every fixture artifact with zero sentinel bytes, backed by `src/fixtures/confidential-delivery-interruption-fixture.ts` (support fixture, not a spec target). The wired runbook-delivery seam extends this to the real executor: `src/browser-use-runbook.test.ts` (+5 C-tier, 38/104) and `src/fixtures/confidential-runbook-delivery-fixture.ts` prove the bounded-write delivery + cleanup:released path leaves run.json sentinel count 0. C/H pass. Public auth run `1a6aa68d-825e-47ad-82af-0252697d2a6e` proves tier-L interruption is unreachable before secret acquisition: native custody is absent and the continuation requires the unshipped signed Browser Use Security product (native-product-absent operator gate: Apple signing U04, 1Password U05, Keychain enrollment U06). |
| DDA-F19 | Prompt injection cannot grant auth, origin, or mutation authority. | C,H,L | UNASSESSED | Adversarial fixture journey missing; G deferred until the H fixture ladder exists. |
| DDA-F20 | Caller metadata remains audit-only and never changes authority. | C,H | PARTIAL | Model tests exist; public differential journey missing. |
| DDA-F23 | Any unhandled exception becomes a typed internal-error envelope with no raw stack or absolute path on stdout. | C,E | PASS | browser-use-sec-seams.test.ts: injected fault yields a typed error envelope with no stack marker or absolute path on stdout; spawned-CLI companion proves the process boundary. |
| DDA-F24 | `--debug` diagnostics pass the secret scan. | C,H | PASS | browser-use-runtime-env.test.ts: the leak-harness sweep over the captured --debug diagnostic trail through the real redactor pipeline finds zero sentinels; a negative control proves the sweep fails closed. |
| DDA-F25 | Hostile run ids are rejected by every consumer, including via `BROWSER_USE_RUN_ID`. | C,E | PASS | browser-use-sec-seams.test.ts spawns the real CLI: `BROWSER_USE_RUN_ID='../../x'` and slash-bearing `--run-id` both exit 2 typed; no state path escapes the base dir. |
| DDA-F26 | Browser Use never attaches to, verifies, launches into, or repairs the user's real default Chrome profile, and never enables remote debugging on it — the automation surface is confined to the dedicated `WARM_CHROME_DEFAULT_PROFILE_DIR`. | C,H | PASS | `runtime/warm-chrome/tests/default-profile-safety.test.ts` proves five contract/hermetic cases: forbidden persistent-setting tokens across shipping browser-use/browser-connect/warm-chrome source; AST allowlist of every Warm Chrome file-content mutation; adversarial split/dynamic/aliased write fixtures; legitimate read control; default-vs-dedicated matcher. Existing check/launch/repair/runtime station tests cover attach, verify, launch, repair, symlink, and resolved-path refusal. No enable-side product path remains: remote debugging is requested only through transient `--remote-debugging-port` against the dedicated profile; no shipping path writes Chrome's persistent setting. Full Warm Chrome suite passes. |

## G. Repository, worktree, state, and concurrency isolation

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-G01 | One installed front door works from the config repository. | E | PASS | Live installed PATH invocation returned Task Intent and runbook envelopes. |
| DDA-G02 | The same front door works from a different product repository. | E,G | FAIL | No acceptance evidence. |
| DDA-G03 | The same front door works from an empty temporary repository. | E,H | PASS | Clean-home Setup integration installs and invokes the same front door outside the source repository. |
| DDA-G04 | Two repositories can run concurrently without shared-run collision. | H,L,G | UNASSESSED | Concurrency journey missing. |
| DDA-G05 | Two worktrees of one repository keep run and target state isolated. | H,L,G | UNASSESSED | Worktree journey missing. |
| DDA-G06 | Run IDs, leases, target state, and artifacts remain correlated. | C,H,L | PARTIAL | Component tests and AE1 exist; cross-repo pair missing. |
| DDA-G07 | Relative repository paths never leak into durable global identity. | C,H | UNASSESSED | Fixture journey missing. |
| DDA-G08 | Repository-local runbook discovery cannot shadow another repository. | C,H,G | FAIL | Repository runbook discovery not implemented. |
| DDA-G09 | Read-only repository permissions do not corrupt global state. | H | UNASSESSED | Fixture journey missing. |
| DDA-G10 | Corrupt repository config fails with a repair path, not fallback. | H | UNASSESSED | Fixture journey missing. |
| DDA-G11 | Environment variables never override explicit safe CLI inputs silently. | C,H | PARTIAL | Parser tests exist; full precedence journey missing. |
| DDA-G12 | Concurrent agents cannot reuse each other's element refs or tabs. | H,L,G | UNASSESSED | Multi-agent continuity journey missing. |
| DDA-G13 | Concurrent runs cannot overwrite active runbook or artifact state. | C,H,G | UNASSESSED | Lease tests exist; integrated journey missing. |
| DDA-G14 | Cleanup removes only state owned by the completed run. | H,L,G | UNASSESSED | Cross-run cleanup journey missing. |
| DDA-G15 | Case-insensitive filesystems cannot collide run ids differing only by case. | C,H | UNASSESSED | Oracle: `R1` and `r1` on an APFS fixture — distinct or refused, never shared state. |
| DDA-G16 | Missing or read-only HOME with unset XDG falls back per contract with a typed warning. | E,H | PASS | browser-use-sandboxed-home.test.ts: declared runtime fallback with typed reason `runtime_dir_unset`, roots confined to the sandbox, read-only HOME admits, missing HOME refuses typed — in-process (H) and via spawned `repair status` projecting runtime_fallback at the boundary (E). |
| DDA-G17 | Relative XDG values are refused with a typed usage error at the process tier. | C,E | FAIL | browser-use-anti-drift-g17.test.ts (skip-marked red) documents the gap: the refusal is typed `xdg_root_relative` naming XDG_STATE_HOME but exits 20 via emitXdgRefusal, not the oracle's exit 2; reclassifying collides with the AE4 identical-refusal-shape invariant and three sibling exit-20 tests — owner decision open. |
| DDA-G18 | Nested invocation inheriting run env vars cannot corrupt the parent run. | C,H | UNASSESSED | Oracle: child process with inherited `BROWSER_USE_RUN_ID` mutates — parent revision conflict typed. |
| DDA-G20 | Store version skew fails typed in both directions without corruption. | C,H | UNASSESSED | Oracle: store fixtures at versions N-1 and N+1 — typed outcomes; store hashes unchanged on refusal. ID G19 reserved for an appendix candidate. |

## H. Run lifecycle, failure recovery, and cleanup

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-H01 | Run status projects state, revision, lane, auth, and next action. | C,E | PARTIAL | Command tests exist; process proof missing. |
| DDA-H02 | Blocked run resume preserves original lane and handoff identity. | C,H,L | PARTIAL | Run tests exist; live journey missing. |
| DDA-H03 | Cancel before dispatch reports no external effect. | C,E | PARTIAL | Model test exists; public process proof missing. |
| DDA-H04 | Cancel after possible dispatch reports unknown and never rollback. | C,H | PARTIAL | Model test exists; journey missing. |
| DDA-H05 | CLI crash before dispatch is safely repeatable. | H | UNASSESSED | Kill fixture missing. |
| DDA-H06 | CLI crash after possible dispatch requires inspection before retry. | H,L | UNASSESSED | Kill fixture missing. |
| DDA-H07 | Adapter process death returns typed failure and preserves run evidence. | H,L | UNASSESSED | Kill fixture missing. |
| DDA-H08 | Browser death returns Browser Entry Handoff and preserves run evidence. | H,L | UNASSESSED | Journey missing. |
| DDA-H09 | Network timeout records whether dispatch may have occurred. | H,L | UNASSESSED | Fixture journey missing. |
| DDA-H10 | Page closure during mutation never reports confirmed. | H,L | UNASSESSED | Fixture journey missing. |
| DDA-H11 | Stale leases are inspectable and repairable without harming live runs. | C,H | PARTIAL | Lock tests exist; process journey missing. |
| DDA-H12 | Corrupt run, artifact, or auth state fails closed with bounded repair. | C,H | PARTIAL | Component tests exist; integrated journey missing. |
| DDA-H13 | Permission-denied state directories return typed diagnostics. | H | UNASSESSED | Fixture journey missing. |
| DDA-H14 | Disk-full or partial artifact writes never produce a valid manifest entry. | H | UNASSESSED | Fixture journey missing. |
| DDA-H15 | SIGINT bounds cleanup and preserves honest external-effect state. | E,H | UNASSESSED | Process signal journey missing. |
| DDA-H16 | Every blocked result carries exactly one usable next safe action. | C,H,L,G | PARTIAL | Many component tests exist; station-wide proof missing. Oracle chains to DDA-H17: dispatching the returned continuation verbatim must succeed. |
| DDA-H17 | Recovery command succeeds from the returned continuation alone. | H,L,G | UNASSESSED | Continuation-following journey missing. |
| DDA-H18 | Completed journeys leave no orphan tabs, adapters, leases, or temp artifacts. | H,L,G | PARTIAL | PAC cleanup noted; systematic proof missing. |
| DDA-H19 | SIGTERM and parent death behave like SIGINT: bounded cleanup, honest external-effect state. | H | UNASSESSED | Oracle: kill harness — same typed state as DDA-H15. |
| DDA-H21 | A leftover named adapter session from a crashed prior run does not block the next run. | H,L | PASS | Hermetic (browser-use-process-hygiene.test.ts) plus live 2026-07-27: a pre-seeded crashed leftover env/profile lease in the real durable store was detected and recovered via fenced takeover — monotonic fencing token, recovered_from naming the crashed holder — then the run completed green with a clean store. |
| DDA-H22 | No background daemon or keepalive persists after any command exits. | E,H | PASS | browser-use-process-hygiene.test.ts: real spawned task/lanes list journeys exit clean with zero surviving descendants (pgrep); every envelope adapter spawn carries MCPORTER_NO_KEEPALIVE (keepalive-gotcha regression pin). |
| DDA-H23 | `repair status` reports only real repairs; `repair apply` executes only declared bounded actions and reports each. | C,E,H | PASS | browser-use-status-families.test.ts: whole-store fingerprint proves repair status lists exactly the seeded breakage and apply fixes exactly it, in-process (C,H) and via spawned real-CLI journeys with the same store diff (E). |
| DDA-H24 | `artifact list` projects the run-scoped manifest; a missing manifest yields a typed empty result. | C,E | PASS | browser-use-status-families.test.ts: absent manifest yields exit 0 ok-empty artifact-manifest envelope and a seeded run projects its row, in-process (C) and spawned (E). |
| DDA-H25 | `targets status` truthfully reflects fresh, stale, and absent run-scoped selected state. | C,E | PASS | browser-use-status-families.test.ts: fresh, stale, and absent selected state yield three mutually distinct typed projections, in-process (C) and spawned with wall-clock-anchored expiries (E). |

## I. Performance, observability, and sustained use

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-I01 | No-arg and help respond within the cold-start budget. | E,H | UNASSESSED | Proposed budget: ≤ 1000 ms cold; measure at E,H. |
| DDA-I02 | Warm discovery and routing respond within the daily-use budget. | E,H,L | UNASSESSED | Proposed budget: ≤ 400 ms warm; measure at E,H,L. |
| DDA-I03 | Each adapter reports execution duration and run correlation. | C,L | PARTIAL | Envelopes carry duration/run id; cross-lane proof missing. |
| DDA-I04 | Diagnostic volume is bounded and respects quiet, verbose, and debug. | C,E,H | PARTIAL | Parser tests exist; process budget missing. |
| DDA-I05 | One hundred sequential read-only runs do not leak processes or state. | H,L | UNASSESSED | Soak journey missing. |
| DDA-I06 | Parallel runs remain within configured concurrency and lease bounds. | H,L | UNASSESSED | Load journey missing. |
| DDA-I07 | Same input and fixture produce deterministic routing and result vocabulary. | C,H | PARTIAL | Pure-policy tests exist; process repeatability missing. |
| DDA-I08 | Artifacts and diagnostics carry enough provenance for later audit. | C,H,L,G | PARTIAL | Schemas exist; provenance = run id, lane, adapter version, endpoint identity hash, timestamps; golden workflow proof missing. |
| DDA-I09 | Secret scan covers stdout, stderr, run store, artifacts, and receipts. | C,H,L,G | PARTIAL | Leak harness exists; golden workflow sweep missing. Owns scan-harness coverage (including `--debug` per DDA-F24); live auth workflow leakage owned by DDA-F06. |
| DDA-I10 | Package payload excludes tests, fixtures, workspace markers, and secrets. | C,E,H | PARTIAL | Build checks exist; packed inspection receipt missing. |
| DDA-I11 | Adapter upgrade changes invalidate stale lane evidence. | C,H | PARTIAL | Integrity tests exist; installed upgrade journey missing. |
| DDA-I12 | A failed acceptance case retains redacted evidence sufficient to reproduce. | H,L,G | UNASSESSED | Acceptance harness artifact contract missing. |
| DDA-I13 | Retention prunes only aged, unleased runs and artifacts. | C,H | UNASSESSED | Oracle: mixed-age fixture store — post-prune set matches policy exactly. Retention module exists with zero acceptance coverage today. |
| DDA-I14 | No user-level mcporter config is consulted on any live path. | E,H | UNASSESSED | Oracle: run with the `chrome-devtools` config entry deleted — identical envelope. Locks in the U6-ET3 observation as a criterion. |

## J. Golden everyday journeys

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-J01 | From an empty repository, discover lanes and complete an anonymous scrape through Agent Browser. | G | FAIL | Installed cross-repo journey missing. |
| DDA-J02 | From a product repository, route a debug request through Chrome DevTools and return evidence. | G | UNASSESSED | Golden journey missing. |
| DDA-J03 | From a product repository, route a frontend interaction proof through Playwright. | G | BLOCKED | Deterministic snapshot dispatch exists; product-repository live journey blocked on the operator-gated pinned adapter install. |
| DDA-J04 | List, show, and run a shipped read-only Browser Runbook through one front door. | G | UNASSESSED | Live journey missing. |
| DDA-J05 | Create, validate, activate, list, show, and execute a new Browser Runbook. | G | FAIL | Authoring lifecycle missing. |
| DDA-J06 | Authenticate through an Item Binding and complete a read-only runbook. | G | FAIL | Native auth capability absent. |
| DDA-J07 | Detect wrong account identity and stop before mutation. | G | FAIL | Operational identity proof missing. |
| DDA-J08 | Expire auth mid-run, repair it, and resume the same Shared Browser Use Run. | G | FAIL | Operational auth and resume journey missing. |
| DDA-J09 | Run Agent Browser, Chrome DevTools, then Playwright against one intended tab. | G | BLOCKED | All three execution paths exist; same-tab live swap journey blocked on the operator-gated pinned adapter install. |
| DDA-J10 | Run two repositories concurrently without state, tab, or artifact collision. | G | UNASSESSED | Golden concurrency journey missing. |
| DDA-J11 | Recover from stopped Agent Chrome using only the returned continuation. | G | UNASSESSED | Public-front-door recovery journey missing. |
| DDA-J12 | Execute a bounded externally visible mutation with identity proof, confirmation, fresh postcondition, and receipt. | G | FAIL | Auth, confirmation, and receipt integration incomplete. |
| DDA-J13 | Multi-page pagination scrape completes with bounded output and per-page provenance. | G | UNASSESSED | Oracle: fixture site with N pages — one result artifact, N provenance entries, size within budget. |
| DDA-J14 | Debug journey returns console and network evidence as a run artifact from a product-repository page. | G | UNASSESSED | Oracle: artifact exists, redacted, correlated to the run id. Sharpens the DDA-J02 oracle. |
| DDA-J16 | Upgrade day: run DDA-J04 on version N, upgrade, run again; runs and knowledge survive. | G | UNASSESSED | Oracle: both runs green; store intact; no re-setup beyond `setup sync`. ID J15 reserved for an appendix candidate. |

## K. Migration and legacy corpus

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-K01 | `migration status` truthfully reports corpus state from the installed CLI. | C,E | PASS | browser-use-migration-corpus.test.ts: in-process lifecycle proof (C) plus a spawned six-subprocess journey over one durable store transitioning empty->inventoried->planned->verified with a well-formed staged_generation (E). |
| DDA-K02 | `migration inventory` and `migration plan` are strictly read-only. | C,E,H | PASS | browser-use-migration-corpus.test.ts: sha256 tree snapshot byte-identical before and after inventory and plan, proven in-process (C,H) and via spawned real-CLI subprocesses (E). |
| DDA-K03 | `migration apply` is idempotent and resumable after interruption. | C,H | PASS | browser-use-migration-corpus.test.ts: crash on the generation-record fsync, rerun converges to staged, third apply reports verified no-op (volatile-overlay fs idiom). |
| DDA-K04 | Legacy source is never modified or deleted until `migration verify` passes. | C,H | PASS | browser-use-migration-corpus.test.ts: source tree hash frozen across inventory/plan/apply/verify; apply stages an inactive copy only. |
| DDA-K05 | Secret-positive Import Candidates are refused per candidate and reported, never salvaged. | C,H | PASS | browser-use-migration-corpus.test.ts: credentials.txt and client-secret.env each quarantine-secret with null destination while service.yml stages; per-candidate refusal. |

## M. Human collaboration and takeover

| ID | Acceptance criterion | Tier | Current verdict | Evidence or gap |
| --- | --- | --- | --- | --- |
| DDA-M01 | Concurrent human action in the selected tab is surfaced by fresh observation; ambiguous outcomes classify `unknown`, never `confirmed`. | H,L | UNASSESSED | Oracle: fixture mutates the DOM between action and verify — outcome `unknown` or `not-achieved`. |
| DDA-M02 | Human navigation in the selected tab mid-run invalidates refs and yields typed recovery. | H,L | UNASSESSED | Oracle: scripted navigation between observe and mutate — stale-ref refusal plus continuation. Complements DDA-D14 (tab close). |
| DDA-M03 | A pending approval expires after a bounded timeout, blocks with one continuation, and leaves no secret-bearing state. | C,H | UNASSESSED | Oracle: approval fixture aged past the bound — typed blocked cause; state scan clean. |
| DDA-M04 | `run status` shows enough for safe human takeover: lane, tab identity, lease holder, pending action. | C,E | UNASSESSED | Oracle: field-presence contract over a blocked-run fixture. |

## Appendix: deferred candidates (not admitted, not counted)

Valid lower-priority candidates preserved from the 2026-07-27 gap audit.
Promote by moving a row into its owning section with its reserved ID.

| Reserved ID | Criterion sketch | Tier | Oracle sketch |
| --- | --- | --- | --- |
| DDA-A23 | Uninstall removes the bin; `setup status` reports absence honestly. | E,H | Post-uninstall status shows missing; repair reinstalls. |
| DDA-A24 | Quarantine xattr on the installed bin yields typed Gatekeeper guidance. | H | `xattr`-tagged fixture bin — named remedy. |
| DDA-A26 | Version projection matches package metadata (merge with DDA-A15 evidence). | C,E | String equality across source, dist, package. |
| DDA-B22 | `BROWSER_USE_MCPORTER_COMMAND_JSON` rejects shell strings and non-arrays at process tier. | C,E | Malformed values — exit 2 typed. |
| DDA-B26 | Malformed, oversized, or interleaved adapter stdout maps to the unparsable taxonomy, never a crash. | C,H | Garbage-emitting fixture adapter — typed code. |
| DDA-C20 | Post-sleep/wake stale CDP connection yields Browser Entry Handoff, not a hang (or fold into DDA-C10). | H,L | Suspended-endpoint fixture — bounded typed failure. |
| DDA-C21 | Chrome version change invalidates attachment assumptions and re-proves. | H,L | Version-drift fixture — fresh proof demanded. |
| DDA-D32 | Download bounding (folded into DDA-D20 as sub-oracle; reserved). | H,L | Path prefix assertion. |
| DDA-E22 | Runbook catalog listing stays deterministic and bounded with large catalogs. | C,E | 500-runbook fixture — sorted, within budget. |
| DDA-F21 | 1Password CLI absent or locked returns typed auth repair distinct from Browser Entry Handoff. | C,E,H | PATH-hidden `op` — auth-domain typed failure. |
| DDA-F22 | Approval-timeout duplicate of DDA-M03 (reserved; M03 owns it). | C,H | See DDA-M03. |
| DDA-G19 | Artifact root on a vanished volume fails typed; manifest stays consistent. | H | Unmount fixture mid-run — typed failure, manifest valid. |
| DDA-H20 | File-descriptor exhaustion fails typed without corrupting state. | H | `ulimit -n` fixture — typed failure, store intact. |
| DDA-I15 | LANG/LC_ALL/TZ variations produce identical envelopes modulo timestamps. | C,H | Matrix run, normalized diff empty. |
| DDA-I16 | Envelope and receipt timestamps are ISO-8601 with explicit offset. | C | Schema regex assertion. |
| DDA-J15 | Hundredth-use soak: repeat DDA-J01 thirty times; state, artifact count, latency within budgets. | G | Post-soak metrics within budgets (or fold into DDA-I05). |
| — | Accessibility-state pages (zoom, reduced motion, forced colors) keep snapshot fidelity. | H,L | Emulated a11y settings fixture — postcondition landmarks still present. |
| — | Localized Chrome (non-English UI) does not break adapter output parsing. | H | Locale-launched fixture — parse success. |
| — | `lanes show <unknown>` typed error at process tier (DDA-B10 sibling). | C,E | Exit 2/20 with safe token. |
| — | Stdin-vs-env envelope precedence for `targets select` proven at process tier. | C,E | Both supplied — stdin's candidate chosen. |

## Initial known root-cause clusters

| Cluster | Rows affected | Initial tag | Next action |
| --- | --- | --- | --- |
| Process and installed entrypoint proof partial | A04, A08-A09, A11-A13, A15-A18, G02 | fixable-now | Add source-built-packed parity and a real product-repository journey. |
| Playwright lane partially operational | B06, B17, D08, D11, J03, J09 | fixable-now | Add trace/archive contracts, install the pinned adapter through its operator gate, then run same-tab live proof. |
| Lane evidence remains unproven | B03, B11-B13, B20, F17 | needs-fixture | Define and run lane conformance producers against pinned adapters. |
| Runbook authoring lifecycle absent | E02-E08, E16, E18, J05 | fixable-now | Design the smallest draft-validate-activate vertical slice. |
| Native auth product absent | E12, F01-F18, J06-J08, J12 | blocked-backend | Complete Browser Use Security entry gate and capture live vault fixtures. |
| Cross-repo state isolation unproved | G02-G14, J01, J10 | needs-fixture | Create two temporary repository fixtures and run one public process in each. |
| Integrated fault journeys absent | H05-H18 | needs-fixture | Build controlled process, adapter, browser, network, and filesystem failures. |
| Security seam guards unproven | B21, C16-C19, D29, D34, E21, F23-F25 | fixable-now | Add contract and hermetic guards for test seams, envelope trust, hostile inputs, and output sanitization. |
| Public families uncovered | K01-K05, H23-H25, B23-B24 | fixable-now | Add contract and process rows for migration, repair, artifact, and targets status surfaces. |
| Target realism fixtures missing | D26-D28, D30-D31, D33 | needs-fixture | Build mixed-target, zero-tab, and many-tab fixtures. |
| Human collaboration absent | M01-M04 | needs-fixture | Author takeover, concurrent-action, and approval-timeout fixtures. |
| Front-door evidence refresh | C01-C06, D01, D06-D13 | fixable-now | Re-run existing live journeys driving only `browser-use`. |
| Runtime environment unproven | A19-A22, A25, G15-G18, G20, H19-H22, I13-I14, B25 | needs-fixture | Build PATH, HOME/XDG, signal, hang, daemon, and store-skew fixtures. |
| Default-profile safety guarded | F26 | closed | Cross-owner persistent-setting scan plus Warm Chrome mutation allowlist and default-profile station proofs pass; only transient launch flags target the dedicated profile. |

## Convergence order

Merged 2026-07-27 gap-audit order; earlier implementation order folded in.

0. Default-profile safety (F26): complete 2026-07-28. Cross-owner contract/hermetic proof forbids persistent remote-debugging enablement and retains default-profile refusal across attach, verify, launch, and repair.
1. Security seam guards: B21, F25, C16-C18, D29, F23 (contract and hermetic tiers; cheapest severity-per-hour).
2. Uncovered public families at contract and process tier: K01-K05, H23-H25, B23-B24.
3. Target realism fixtures: D26-D28, D30-D31, D33.
4. Source-built-packed parity and a real product-repository tracer bullet (A11, G02); front-door evidence refresh for C01-C06, D01, D06-D13.
5. Envelope version negotiation and store compatibility: C16, C19, G20; cheap anti-drift A19-A20, G17.
6. Process hygiene: H22 (no daemon), B25 (hang timeout), H21 (leftover session); runtime environment A21-A22, G16, F24.
7. Remaining Playwright trace/archive contracts, then operator gate opens B17/J03/J09 BLOCKED rows and live same-tab proof.
8. Cross-repository isolation pair; runbook draft-validate-activate slice; integrated failure and cleanup journeys.
9. Auth readiness implementation and live credential-safe proof; auth-adjacent typed failures (M03, appendix F21) first — they need no native custody.
10. Golden workflows (J13, J14, J16) and sustained-use soak; ratify the proposed numeric budgets in A08, I01, I02, D22.
