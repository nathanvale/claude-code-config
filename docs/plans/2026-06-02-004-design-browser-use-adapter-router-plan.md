---
title: Design browser-use Browser Adapter Router
type: architecture
status: completed
date: 2026-06-02
origin: docs/plans/2026-06-02-003-fix-browser-use-mcporter-command-resolution-plan.md
---

# Design browser-use Browser Adapter Router

## Summary

Design `browser-use` as the Browser Adapter Router. The router asks candidate adapters for current capability reports before choosing, then routes a Bounded Browser Outcome only when the selected adapter satisfies the requested preconditions and capability bundle. Evidence beats clever choosing: ranking orders proven candidates; missing proof becomes recovery, not inference. Forced adapters fail closed when unsupported. Docs research is a structured recovery action, not prose-only advice.

## Problem Frame

The `mcporter` fix exposed a larger design pressure: `browser-use` should not hardcode one browser automation tool, but it also must not become a fake universal browser API. Adapters can change over time. Agent Browser may gain memory debugging later; Playwright MCP and Chrome DevTools MCP can shift too. Capability truth should be runtime/discovery data with provenance, not permanent skill prose.

## Branch Schema Addendum

Added: 2026-06-03.

Landed on branch:

- `32d46fd`: implemented Router runtime schema owners for command contract, manifests, validation, routing, and CLI envelopes.
- `08fae9c`: linked `SKILL.md` workflow prose to Router runtime discovery instead of prose capability truth.
- `85a579c`: tightened Router runtime structure after simplify pass without changing policy.
- `15ae107`: hardened fail-closed paths from code review and expanded Router failure tests.
- `111fd95`: marked this plan completed for the initial runtime scope.
- `1e900a3`: split Router owners into contract, model, engine, discovery, recovery, validation, and CLI projection.
- `1e900a3`: proved command discovery flags, rendered help, parser acceptance, and runtime semantics align.
- `1e900a3`: added Router test matrix, recovery metadata plan, command flag contract plan, operator recovery choices plan, and create-cli reference updates.
- `efebda0`: normalized type-only imports after Router seam extraction.
- `6ee3a9c`: kept bounded research detail behind `diagnostic_trail`; did not widen the facade envelope.
- `6ee3a9c`: hardened stale self-report, missing capability, prefer-mode, freshness, auth/session, and validation paths.
- `6ee3a9c`: added ADR 0013 for Router research recovery through `diagnostic_trail` and updated domain context.
- `d51103d`: added Router CLI smoke artifacts for 100 core cases and 100 hints/recovery cases.
- `6c7f74e`: exposed `router-cli-smoke` through agent discovery.
- `19e82c7`: named smoke artifact fixture metadata as `temp_fixture_dir`.
- `67d08ed`: covered run-id arguments for usage-failure scenarios.
- `ecdb4f9`: aligned recovery schema decisions, manifest verification vocabulary, partial recovery, and auth/target-origin actions.
- `3174b60`: hardened Router smoke artifacts with schema metadata, command hashes, structured assertions, and expanded coverage.
- `507eb3f`: recorded product JSON decisions in this plan.
- `9e09a83`: emitted Router product failure `data` and validated `evaluation_date` for route success/failure outputs.

Branch collateral:

- Added `skills/router-cli-smoke/` as the Router smoke validation skill.
- Added `.agents/skills/router-cli-smoke` discovery entry.
- Added `skills/browser-use/TEST_MATRIX.md` as the Router and Browser Adapter Proof verification matrix.
- Added `docs/adr/0013-router-research-recovery-uses-diagnostic-trail.md`.
- Added `docs/plans/2026-06-03-001-refactor-router-recovery-metadata-plan.md`.
- Added `docs/plans/2026-06-03-002-refactor-router-command-flag-contract-plan.md`.
- Added `docs/plans/2026-06-03-003-feat-facade-operator-recovery-choices-plan.md`.
- Updated `AGENTS.md`, `CONTEXT.md`, `skills/browser-use/SKILL.md`, and create-cli references for Router ownership and CLI surface guardrails.
- Expanded Warm Chrome and Browser Adapter Proof tests where Router command-surface and run-id behavior intersected existing preflight contracts.

Related cross-repo prerequisite:

- `side-quest-engineering` `00e4db4d`: allowed generic facade error envelopes to carry package-owned `data`; Router still owns route failure field semantics.

Accepted follow-up decisions:

- Keep Router semantics local to `browser-use`.
- Hoist to `@side-quest/cli-command-facade` only for generic envelope support, such as package-owned `data` typing or validation.
- Rename routable manifest verification to `maintainer_verified_manifest`.
- Treat docs review as research/advisory input, not the routable verification method.
- Map `adapter_capability_partial` to `change_route_input` in V1.
- Keep `accept_partial_adapter` inactive until degraded routing exists.
- Add active recovery actions: `verify_auth_session`, `verify_target_origin`.
- Add concise Router-owned failure `data` for route failures.
- Add route failure `data` only for validated route-evaluation failures; keep `route_evidence_invalid` outside Route Validity data.
- Add `evaluation_date` to every validated route evaluation product `data`; the current Router clock is date-only.
- Keep bounded research payloads behind `diagnostic_trail`.
- Add explicit parent-run correlation for reusable reports and caller-assembled evidence.
- Emit command discovery metadata once per Router CLI smoke artifact.
- Keep command discovery metadata smoke/artifact-level unless agents need it outside tests.

Facade boundary:

- Facade owns generic envelope shape, continuation validation, runtime action validation, diagnostic pointers, and package-owned payload allowance.
- Router owns adapter policy, recovery action ids, route failure data fields, report provenance vocabulary, parent-run semantics, and smoke assertions.
- Do not add Router-specific policy or recovery ids to the facade.
- Open a facade follow-up only if Router failure `data` needs generic facade type, clone, or validation support.

Follow-up unit status:

- FU1 landed in `ecdb4f9`.
- FU2 landed in `9e09a83`; generic facade `data` support landed separately in `side-quest-engineering` `00e4db4d`.
- FU3 remains accepted but not landed in Router runtime evidence/report surfaces.
- FU4 landed in `3174b60`; smoke skill discovery landed in `6c7f74e`.
- Smoke artifacts include artifact-level `parent_run_id`; this is not FU3 product evidence correlation.

## Requirements

### Routing Policy

- R1. `browser-use` owns adapter policy and selection.
- R2. Router asks adapters for capabilities before choosing in `auto` and `prefer` modes.
- R2a. Preference and ranking never create routable truth.
- R3. Forced adapter mode asks only the forced adapter and never silently switches.
- R4. Capability bundles require all capabilities at `full` support unless action explicitly allows degraded execution.
- R5. `partial` support fails closed by default with `adapter_capability_partial`.
- R5a. Task-facing bundle names resolve to concrete required capabilities before routing.
- R5b. Tasks may add explicit required capabilities to a bundle; V1 does not use weighted scoring.
- R5c. `route` consumes supplied precondition, proof, and capability evidence; it does not invoke Browser Adapter Proof in V1.
- R5d. `route` receives evidence through a machine-readable JSON envelope path or stdin; exact fields stay runtime-owned.
- R5e. V1 caller/skill driver assembles the evidence envelope from command outputs and task preconditions.
- R5f. V1 partial support recovery uses `change_route_input`; degraded acceptance is not an active route continuation.

### Capability Reports

- R6. Capability states are `full`, `partial`, `none`, `unknown`, and `stale`.
- R7. Reports include provenance: adapter version, source URL, checked date, verification method, per-capability confidence, and stale-after policy.
- R7a. Reports include report-level provenance plus per-capability evidence references.
- R7b. Routable manifests use `verification_method: "maintainer_verified_manifest"`.
- R7c. Docs review may inform a manifest refresh, but does not name routable verification.
- R8. V1 source is a `browser-use` adapter registry plus provenance-bearing capability manifests.
- R8a. Manifest-backed routable reports live with Router runtime data/code under `skills/browser-use/scripts/`, not docs or references.
- R8b. V1 manifests are TypeScript constants in a separate Router manifest module, validated through the same report validator as adapter self-reports.
- R9. Adapter-owned report commands may override manifests only after schema validation.
- R9a. Self-report commands are discovered only through registry-declared command vectors or MCP sources.
- R10. Docs-only research never routes as truth; it can only refresh a report after an explicit verification step.
- R11. Candidate adapters in V1 registry: `chrome-devtools`, `agent-browser`, `playwright-cdp`.
- R11a. Registry membership means known Browser Adapter identity, not routability.
- R12. Reports include `attachment_model`: verified Warm Chrome, separate browser context, storage-state import, or unknown.
- R12a. Every route requires attachment compatibility with the verified Warm Chrome/session model.
- R12b. `storage-state import` is reportable evidence but not compatible attachment for Browser Adapter Router V1.
- R12c. Separate browser context is reportable evidence but not compatible attachment for Browser Adapter Router V1.
- R13. Reports include adapter trust data: registry id, resolved command path or MCP source, schema version, and validation result.

### Preconditions

- R14. Preconditions stay separate from adapter capabilities.
- R15. Auth/session readiness is a task precondition, not an adapter capability.
- R16. Auth/session checks require task-supplied evidence: target origin, verified profile identity, and account/session match when observable.
- R16a. `browser-use` owns auth/session gate shape and fail-closed behaviour, not domain-specific login knowledge.
- R16b. Target page/origin evidence is required when the task declares that precondition.
- R16c. Auth/session failures continue with `verify_auth_session`.
- R16d. Target-origin failures continue with `verify_target_origin`.
- R17. Missing, empty, stale, or unverifiable preconditions fail closed before adapter routing.
- R17a. Router validates evidence freshness from envelope metadata and fails closed when freshness metadata is missing or stale.
- R17b. Router requires compatible run correlation across supplied evidence and fails closed on mixed-run evidence.
- R17c. Reusable evidence may correlate through an explicit `parent_run_id`; same-run-only is not required for prepared reports.

### Recovery

- R18. Research recovery uses the same envelope as CLI recovery: `error.code`, `runtime_actions`, `continuation.next_action_id`, structured hints.
- R18a. Route execution never auto-runs docs research; it emits `research_adapter_capability` as an explicit recovery action.
- R18b. Route failure JSON includes concise Router-owned `data`.
- R18c. Route failure `data` includes decision facts, not full bounded research payloads.
- R19. Research recovery has loop bounds: last checked, stale reason, retry posture, and terminal condition.
- R20. `allow_degraded` is out of V1 route execution except explicit prototype demonstration states.

## Key Technical Decisions

- KTD1. **Evidence beats clever choosing:** Router ranks only proven candidates; missing, stale, partial, or docs-only evidence becomes recovery.
- KTD1a. **Router before adapter:** Requests enter `browser-use`; adapters do not own browser entry, Warm Chrome readiness, or policy.
- KTD1b. **Preconditions before routing:** Run facts must pass before adapter capability ranking starts.
- KTD1c. **Proof stays proof:** Browser Adapter Proof remains read-only attachment proof; Router policy, ranking, and capability reports live in a separate runtime surface.
- KTD1d. **Route names selection:** Router V1 exposes `route` for adapter selection, `report` for capability report discovery, and `status` for human projection; Browser Adapter Proof keeps `check`.
- KTD1e. **Route decides from evidence:** Missing adapter proof emits recovery such as `prove_adapter_attachment`; `route` does not probe adapters in V1.
- KTD1f. **Evidence envelope input:** Router input is one JSON evidence envelope, not many flags or implicit latest-proof files.
- KTD1g. **Caller assembles evidence:** V1 has no `prepare` command and no implicit prior-output reads.
- KTD1h. **Freshness enforced at route:** Router rejects stale or freshness-less evidence before selection.
- KTD1i. **Run correlation before selection:** Router rejects evidence that cannot be tied to the same route run or an explicit parent run.
- KTD2. **Capability bundle routing:** Real tasks request named bundles where stable; the Router evaluates resolved capability arrays.
- KTD2a. **Bundle ownership:** `browser-use` owns browser-mechanics bundle semantics; domain skills request outcomes or add explicit required capabilities.
- KTD3. **Full support default:** `full` is runnable. `partial`, `none`, `unknown`, and `stale` need recovery or explicit user acceptance.
- KTD4. **Policy object:** Model policy as `mode`, `adapter_id`, `minimum_support`, and `fallback_allowed`.
- KTD5. **Forced means no fallback:** Suggested adapters are informational unless the user relaxes policy.
- KTD5a. **Force is not prefer:** `force adapter` proves only that adapter or stops; `prefer adapter` is the only mode that may fall back.
- KTD6. **Research as explicit recovery:** Context7/doc lookups are emitted as `research_adapter_capability` runtime actions with bounded retry, not auto-run route continuation.
- KTD7. **Static matrix is research only:** Prototype data is not runtime catalog data.
- KTD8. **Registry-owned V1:** `browser-use` owns a small adapter registry and manifest-backed reports until adapters expose validated self-report commands.
- KTD9. **Attachment matters:** A `full` action capability is insufficient when the adapter cannot attach to the verified browser/session model.
- KTD10. **Ranking is explicit:** `auto` uses task bundle ranking, registry ranking, confidence, then adapter id as final deterministic tie-break.
- KTD11. **Trust before command:** Adapter IDs resolve through the registry; command vectors stay argv arrays, never shell strings.
- KTD11a. **Self-report cannot self-invoke:** Adapter output cannot declare or alter its own report command path.
- KTD12. **Research must prove:** Docs lookup can propose a refresh, but only verification updates a routable report.
- KTD12a. **No human-trust shortcut:** Human acceptance of docs-only evidence does not promote an adapter capability to routable truth.
- KTD13. **Manifest verification is named as verification:** Router-owned manifests use `maintainer_verified_manifest`; docs review stays advisory input.
- KTD14. **Partial stays closed in V1:** `adapter_capability_partial` points callers to change route input until degraded routing exists.
- KTD15. **Task preconditions get task recovery:** Auth/session and target-origin failures use precondition-specific recovery actions, not adapter proof.
- KTD16. **Failure data is Router-owned:** Route failures emit concise decision data; the facade stays generic.
- KTD17. **Parent runs correlate prepared evidence:** Reports prepared before route execution use explicit parent-run correlation.
- KTD18. **Smoke artifacts carry discovery once:** Command discovery metadata is artifact-level audit context, not per-case noise.

## Capability Model

- Preconditions:
  - `warm_chrome_ready`: verified loopback CDP endpoint and profile.
  - `adapter_attached_verified_browser`: adapter can act against that browser/session model.
  - `auth_session_ready`: task/domain check confirms target origin and session when needed.
- Adapter capabilities:
  - `snapshot_refs`
  - `element_actions`
  - `selector_actions`
  - `screenshot_media`
  - `console_debug`
  - `network_inspection`
  - `performance_profile`
  - `devtools_performance_insight`
  - `memory_debug`
  - `react_vitals`
- Capability distinction:
  - `performance_profile`: capture or expose profile/trace data.
  - `devtools_performance_insight`: produce DevTools-specific performance analysis or insight.
  - `memory_debug`: inspect browser memory/debugging state without adapter-name bias; evidence decides support.

## Capability Discovery V1

- Registry source: `browser-use` runtime code, not skill prose.
- Registry ids: `chrome-devtools`, `agent-browser`, `playwright-cdp`.
- Registry membership does not imply safe routing.
- Manifest source: Router runtime data/code under `skills/browser-use/scripts/`.
- Manifest format: TypeScript constants in `browser-adapter-router-manifests.ts`.
- Report source order:
  - Validated adapter self-report command when available.
  - Validated `browser-use` owned TypeScript manifest with provenance and stale-after.
  - No routable report when neither exists.
- `report` owns self-report execution and manifest validation; `route` consumes supplied reports.
- `report` side effects are check/network only; it does not click, navigate, capture media, or otherwise perform browser action.
- Missing report: `adapter_capability_unknown`.
- Empty report: `adapter_capability_unknown`.
- Malformed report: `adapter_capability_unknown` plus schema diagnostic.
- Invalid adapter self-report JSON stays report discovery failure: emit `adapter_capability_unknown` plus schema diagnostics, not `route_evidence_invalid`.
- Stale report: `adapter_capability_stale` only when a valid report exceeded freshness policy.
- Docs-only result: advisory evidence; does not update report.
- Docs, references, and research artifacts cannot serve as routable manifests.
- Routable manifest reports use `maintainer_verified_manifest` as the verification method.
- `maintainer_docs_review` is not a routable verification method.
- Full route requires fresh report and confidence `>=75` for every required capability.
- Route confidence is the minimum confidence across required capabilities.
- Docs-only research may emit `research_signal` or `advisory_signal`; it is not route confidence.
- Numeric research signals are capped below the route threshold.
- `full` support requires verified Warm Chrome attachment compatibility for Browser Adapter Router V1.

## Trust Boundaries

- Adapter ids are enum-like registry keys.
- Resolved adapter command or MCP source is provenance-logged.
- Command invocation uses argv arrays.
- Self-report command vectors come from the registry only.
- Adapter env vars are registry-allowlisted; no broad ambient env passthrough.
- Self-reported capabilities never grant permissions beyond policy.
- Media proof excludes raw artifact paths from logs.
- Verbose diagnostics redact sensitive evidence.
- Screenshot/PDF/video retention is explicit per run.
- Sensitive captures are disclosed to the user when produced.

## Policy Semantics

- `auto`: ask candidate adapters, filter to fresh full matches, choose by ranking.
- `auto` considers only fully evidenced candidates; missing-proof candidates are skipped with recovery evidence.
- `prefer adapter`: ask preferred adapter first; if not full, fall back only when `fallback_allowed=true`.
- `prefer adapter` with missing preferred proof falls back only when `fallback_allowed=true`; otherwise it emits `prove_adapter_attachment`.
- `prefer adapter` with `fallback_allowed=false` fails closed when the preferred adapter is not full.
- `force adapter`: ask forced adapter only; fail closed if not full.
- `force adapter` with missing proof emits `prove_adapter_attachment`; alternatives are informational only.
- `minimum_support`: default `full`.
- `allow_degraded`: explicit per action or user choice, never implicit; not routed in V1.
- Ranking:
  - Task bundle priority when declared.
  - Registry priority when task priority is absent.
  - Route confidence after task and registry priority.
  - Lexicographic adapter id as final tie-break.
  - Emit ranking evidence on every `auto` selection.
- Output:
  - Emit concise candidate decisions for selected, skipped, and rejected candidates.
  - Do not emit full raw reports unless a debug mode explicitly asks.
  - Use existing CLI diagnostic flags for verbose evidence; no bespoke raw-report flag in V1.
- Bundles:
  - Task-facing bundle names are presets, not guarantees.
  - Runtime routing evaluates resolved required capabilities.
  - Extra required capabilities may narrow a bundle.
  - Seed bundle names: `snapshot_page_action`, `visual_proof_capture`, `runtime_debug_inspection`, `performance_profile`, `runbook_step_execution`.
  - Exact bundle members stay runtime-owned.
  - Framework-specific needs such as `react_vitals` start as extra required capabilities, not seed bundles.
  - No weighted capability scoring in V1.

## Recovery Semantics

- `adapter_capability_none`: required capability reports `none`.
- `adapter_capability_unknown`: no valid current report exists.
- `adapter_capability_stale`: a valid report exists but exceeded freshness policy.
- `adapter_capability_partial`: adapter has adjacent/weaker support.
- `adapter_attachment_unverified`: required Browser Adapter Proof evidence is missing or unverifiable.
- `adapter_attachment_incompatible`: supplied attachment evidence is verified but incompatible with Browser Adapter Router V1.
- `route_evidence_invalid`: supplied evidence envelope is missing, unreadable, malformed, or schema-invalid.
- `route_evidence_mixed_run`: supplied evidence cannot be tied to the same route run or explicit parent run.
- `route_evidence_stale`: supplied route evidence expired before selection.
- `auth_session_unverified`: task-required auth/session evidence is missing, unverifiable, or mismatched.
- `target_origin_unverified`: task-required target origin/page evidence is missing, unverifiable, or mismatched.
- `research_adapter_capability`: structured docs research action with adapter, capability, query, sources, last checked, stale reason, retry posture, and terminal condition.
- `prove_adapter_attachment`: run Browser Adapter Proof for a candidate adapter, then retry routing with fresh proof evidence.
- `verify_auth_session`: verify target origin, profile identity, and account/session match, then retry routing.
- `verify_target_origin`: verify target page/origin evidence, then retry routing.
- `accept_partial_adapter`: deferred action; do not emit in active V1 route failures.
- `research_complete_unverified`: docs lookup finished but did not refresh runtime truth.
- `verify_capability_report`: probe or validate evidence before report refresh.
- V1 has no `verify` command and no `report --verify`; executable probes remain a recovery action/future implementation path.
- `use_selected_browser_adapter`: use the Router-selected Browser Adapter and emitted constraints.
- Router emits one `continuation.next_action_id` per route failure; alternatives are explanatory only.
- Router success is valid for one Bounded Browser Outcome and emits route validity constraints such as no adapter switching, no cold-browser fallback, and reroute when task bundle, target origin/page, selected adapter, proof, capability evidence, or preconditions change or expire.

## Media Proof Policy

- `browser-use` owns run-scoped media proof metadata.
- Adapters produce artifacts; they do not decide retention or disclosure policy.
- Capture only task-relevant viewport or artifact.
- Avoid credential fields when feasible.
- Store artifacts in a run-scoped path.
- Emit artifact paths to the user, not logs.
- Delete or expire artifacts per run retention policy.

## Follow-Up Units

### FU1. Align active recovery vocabulary

- Modify `skills/browser-use/scripts/command-contract.ts`.
- Modify `skills/browser-use/scripts/browser-adapter-router-recovery.ts`.
- Modify Router tests and Router CLI smoke expectations.
- Rename manifest verification strings to `maintainer_verified_manifest`.
- Map `adapter_capability_partial` to `change_route_input`.
- Add `verify_auth_session` and `verify_target_origin`.
- Prove `recoverability="authenticate"` stays aligned for auth/session and target-origin failures.

### FU2. Add route failure data

- Keep facade schema unchanged unless generic package-owned `data` support is missing.
- Add `data.failure_kind`.
- Add `data.required_capabilities`.
- Add `data.routing_started`.
- Add `data.candidate_decisions`.
- Add `data.informational_alternatives`.
- Add compact research pointer only when research recovery already exists.
- Do not embed full bounded research fields.
- Apply only after route evidence validates into a Validated Route Evidence Envelope.
- Leave `route_evidence_invalid` as input failure with `error`, `continuation`, and no route decision `data`.
- Do not add safe parser/input `data` to `route_evidence_invalid`; keep parse diagnostics in smoke artifacts or diagnostic surfaces.
- Add `data.evaluation_date` to validated route-evaluation failures.
- Leave `route_evidence_invalid` without `evaluation_date` because no route evaluation occurred.

### FU3. Add parent-run correlation

- Add explicit parent-run field to reusable evidence/report surfaces.
- Accept same run or explicit parent run.
- Reject mixed unrelated evidence before routing.
- Prove prepared report then route workflow.
- Prefer `parent_run_id` over source-specific fields such as `report_run_id` so proof, auth, report, and caller-assembled evidence share one correlation model.
- Keep route invocation `run_id` distinct from reusable evidence parent run ids.

### FU4. Enrich smoke artifacts

- Add artifact-level `schema_version`.
- Add artifact-level `artifact_id`.
- Add artifact-level generator command.
- Add artifact-level Bun version and OS.
- Add artifact-level command discovery metadata.
- Add structured assertion objects.
- Redact saved commands and environments consistently.
- Do not add product command discovery fields or commands in this slice.

## Example Routes

- Manpower timesheet:
  - Preconditions: `warm_chrome_ready`, `adapter_attached_verified_browser`, `auth_session_ready`.
  - Bundle: `snapshot_page_action`.
  - Resolved capabilities example: `snapshot_refs`, `element_actions`, `screenshot_media`.
  - Auto likely selects Agent Browser CLI or Chrome DevTools MCP depending on current capability report.
- Debug web app profile:
  - Preconditions: `warm_chrome_ready`, `adapter_attached_verified_browser`.
  - Bundle: `runtime_debug_inspection`.
  - Resolved capabilities example: `network_inspection`, `console_debug`.
  - Auto likely selects Chrome DevTools MCP when DevTools depth matters.
- Capture submitted-state proof:
  - Preconditions: `warm_chrome_ready`, `adapter_attached_verified_browser`.
  - Bundle: `visual_proof_capture`.
  - Resolved capabilities example: `screenshot_media`.
  - Route result includes run-scoped media proof metadata; raw artifact paths stay out of logs.
- Execute one Browser Runbook step:
  - Preconditions: `warm_chrome_ready`, `adapter_attached_verified_browser`.
  - Bundle: `runbook_step_execution`.
  - Resolved capabilities example: `snapshot_refs`, `element_actions`, `selector_actions`.
  - `browser-domain-memory` owns runbook content; `browser-use` routes adapter mechanics for the step.
- Check React vitals:
  - Preconditions: `warm_chrome_ready`, `adapter_attached_verified_browser`.
  - Bundle: `performance_profile`.
  - Extra required capabilities example: `react_vitals`, `console_debug`.
  - Auto likely selects Agent Browser CLI if current report has React probe support.
- Forced Agent Browser + memory debugging:
  - If current report says `none`, fail closed.
  - Suggest Chrome DevTools MCP as informational only.
  - Offer `research_adapter_capability` if data is stale/unknown or docs may have changed.

## Implementation Units

### U0. Define adapter registry and discovery interface

- **Goal:** Define candidate adapters, report source order, and discovery entry point before routing.
- **Files:** `skills/browser-use/scripts/command-contract.ts`, `skills/browser-use/scripts/browser-adapter-router.ts`, `skills/browser-use/scripts/browser-adapter-router-manifests.ts`, `skills/browser-use/scripts/browser-adapter-router.test.ts`, `skills/browser-use/scripts/browser-adapter-router.sh`
- **Test Scenarios:**
  - Router command contract exposes `route`, `report`, and `status`.
  - `route` accepts an evidence envelope path or stdin JSON.
  - Exact evidence fields are owned by runtime code/tests, not plan prose.
  - V1 has no `prepare` command.
  - Route does not read prior command output from implicit filesystem locations.
  - `status` projects a supplied evidence envelope for humans without hidden latest-route state.
  - `status` does not read implicit latest proof or route files.
  - `route` and `status` use the same pure route evaluator and differ only by renderer.
  - Registry includes `chrome-devtools`, `agent-browser`, and `playwright-cdp`.
  - Registry declares self-report command vectors or MCP sources when available.
  - Self-report output cannot alter its command vector or MCP source.
  - Self-report command env uses registry allowlist and does not pass ambient secrets.
  - Missing manifest and missing self-report command emit `adapter_capability_unknown`.
  - Malformed report emits schema diagnostic and fails closed.
  - Malformed or empty reports are `unknown`, not `stale`.
  - Valid reports past stale-after are `stale`, not `unknown`.
  - Report source priority prefers validated self-report over manifest.
  - Manifest constants pass through the same validator as adapter self-reports.
  - Existing one-adapter proof stays scoped to `chrome-devtools`.
  - Browser Adapter Proof command surface remains read-only attachment proof.
  - `report` validates registry-declared self-report output when available.
  - `report` falls back to validated TypeScript manifests.
  - `report` contract declares check/network side effects and no browser action.

### U1. Define capability report contract

- **Goal:** Specify the runtime-readable shape for adapter capability reports.
- **Files:** `skills/browser-use/scripts/command-contract.ts`, `skills/browser-use/scripts/browser-adapter-router.ts`, `skills/browser-use/scripts/browser-adapter-router.test.ts`
- **Test Scenarios:**
  - Report accepts `full`, `partial`, `none`, `unknown`, and `stale`.
  - Report requires provenance fields.
  - Report requires confidence per declared capability.
  - Report requires per-capability evidence references when capability evidence differs.
  - Report requires `attachment_model`.
  - `storage-state import` attachment fails compatibility in V1.
  - Separate browser context attachment fails compatibility in V1.
  - Report requires trust fields for adapter id and resolved command/MCP source.
  - Missing provenance fails validation.
  - Stale report emits `adapter_capability_stale`.
  - Docs-only report cannot route as `full`.
  - Fresh report with any required capability below confidence `75` fails closed.
  - Route confidence is computed as the minimum across required capabilities.

### U2. Define adapter policy resolver

- **Goal:** Implement routing semantics for `auto`, `prefer`, and `force`.
- **Files:** `skills/browser-use/scripts/browser-adapter-router.ts`, `skills/browser-use/scripts/browser-adapter-router.test.ts`
- **Test Scenarios:**
  - Auto asks candidates before choosing.
  - Route consumes supplied Browser Adapter Proof evidence and does not invoke proof.
  - Route consumes supplied capability reports and does not invoke self-report commands.
  - Route rejects missing, malformed, or unreadable evidence envelope.
  - Route rejects stale evidence and evidence without freshness metadata.
  - Route rejects mixed-run evidence.
  - Missing candidate proof emits `prove_adapter_attachment`.
  - Auto can route a fully evidenced candidate while disclosing skipped missing-proof candidates.
  - Auto does not route silently when missing-proof candidates were skipped.
  - Prefer falls back only when allowed.
  - Prefer with missing preferred proof fails closed when fallback is not allowed.
  - Prefer with missing preferred proof may fall back only when fallback is allowed and another candidate is fully evidenced.
  - Force never falls back.
  - Force with missing proof fails closed and does not consider alternatives for routing.
  - Partial does not route as success by default.
  - Auto uses task bundle ranking before registry ranking.
  - Router evaluates resolved required capabilities, not bundle names alone.
  - Explicit required capabilities can narrow a task-facing bundle.
  - Auto emits ranking evidence.
  - Route success uses `use_selected_browser_adapter`, not Browser Adapter Proof's success action.
  - Route success emits constraints for selected adapter validity.
  - Task bundle, target origin/page, selected adapter, proof, capability evidence, or precondition changes require rerouting before adapter action.
  - Evidence expiry requires rerouting before adapter action.
  - Adapter-level snapshot/ref freshness remains adapter action policy, not Router reroute policy.
  - Route output includes concise candidate decisions.
  - Route output omits full raw reports by default.
  - Full action support with incompatible `attachment_model` fails closed.
  - Attachment compatibility is required for authenticated and unauthenticated tasks.
  - `allow_degraded` does not route in V1.

### U3. Define research recovery envelope

- **Goal:** Make docs research a structured recovery action with loop bounds.
- **Files:** `skills/browser-use/scripts/command-contract.ts`, `skills/browser-use/scripts/browser-adapter-router.ts`, `skills/browser-use/scripts/browser-adapter-router.test.ts`
- **Test Scenarios:**
  - Stale capability emits `research_adapter_capability`.
  - Known missing with full alternative emits informational suggestion without forced fallback.
  - Research action includes query, sources, stale reason, last checked, retry posture, terminal condition.
  - Research action may include `research_signal` or `advisory_signal`, not route confidence.
  - `continuation.next_action_id` matches an available runtime action.
  - Route failure emits one canonical `continuation.next_action_id`.
  - Alternative recovery actions do not become parallel continuation paths.
  - Missing attachment proof recovery uses `prove_adapter_attachment`.
  - Research complete without verification emits `research_complete_unverified`.
  - Verification action can refresh report only through accepted verification method.
  - V1 command contract does not expose `verify` or `report --verify`.

### U4. Rewrite Router prototype

- **Goal:** Rebuild the visual artifact around Router decisions without making it look like runtime truth.
- **Files:** `prototypes/browser-adapter-router/research.html`, `CONTEXT.md`, `skills/browser-use/SKILL.md`
- **Test Scenarios:**
  - Prototype uses Browser Adapter Router terminology throughout.
  - Prototype models `report`, `route`, and `status` as separate command surfaces.
  - Prototype shows caller-assembled evidence envelope flow without hand-maintained envelope schema.
  - Prototype shows Bounded Browser Outcome route validity and reroute triggers.
  - Prototype shows concise candidate decisions for selected, skipped, and rejected adapters.
  - Prototype labels static capability data as research artifact.
  - Prototype does not route `partial` as success.
  - Prototype state map covers initial, full success, partial fail-closed, missing fail-closed, stale/unknown recovery, forced failure, research pending, research terminal, and degraded-accepted demo state.
  - Route result shows mode, requested adapter, selected adapter or fail-closed status, bundle support, provenance summary, fallback decision, runtime actions, and `continuation.next_action_id`.
  - Matrix, route result, and evidence blocks all state they are research artifacts, not runtime reports.
  - Skill prose links to runtime capability discovery instead of listing adapter truth.
  - Skill prose shows the V1 sequence: Warm Chrome Preflight, Browser Adapter Proof, Router report, caller-assembled envelope, Router route.

### U5. Add precondition and media-proof guardrails

- **Goal:** Keep authenticated browser work and captured proof from becoming implicit trust leaks.
- **Files:** `skills/browser-use/scripts/command-contract.ts`, `skills/browser-use/scripts/browser-adapter-router.ts`, `skills/browser-use/scripts/browser-adapter-router.test.ts`
- **Test Scenarios:**
  - Auth/session precondition requires target origin and verified profile identity.
  - Declared target page/origin precondition requires matching supplied evidence.
  - Missing or unverifiable auth/session precondition fails before adapter routing.
  - Screenshot/media proof emits run-scoped artifact handling metadata.
  - Proof artifacts are not written into diagnostic logs.
  - Adapter output cannot override `browser-use` retention or disclosure metadata.

## Scope Boundaries

- Do not implement this inside the `mcporter` command-resolution slice.
- Do not hardcode capability truth in `SKILL.md`.
- Do not treat Context7 search results as runtime truth without capability report refresh.
- Do not let adapters own Warm Chrome readiness or browser entry.
- Do not silently switch away from a forced adapter.
- Do not route from preference, docs familiarity, or adapter folklore.
- Do not let `allow_degraded` route real adapter actions in V1.
- Do not treat domain-specific login/MFA as generic browser entry.
- Do not expand Browser Adapter Proof action support for future adapters unless their proof path is defined.
- Do not duplicate exact Router capability vocabulary in `CONTEXT.md`; runtime contract code/tests own it.
- Do not add hand-maintained pseudo-envelope examples; runtime code/tests or generated docs own evidence shape.

## ADR

- `docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md`
- Captures the trade-off against prose matrices, universal browser APIs, docs-only truth, and automatic fallback.

## Acceptance Examples

- AE1. Given `auto` mode and a task bundle, when multiple adapters report fresh `full` support, then `browser-use` chooses by task ranking, registry ranking, confidence, then adapter id, and emits ranking evidence.
- AE2. Given `force agent-browser` and required `memory_debug` reports `none`, then `browser-use` fails closed and does not switch to Chrome.
- AE2a. Given `force agent-browser` and Chrome DevTools has full support, then Chrome DevTools is emitted only as an informational suggestion.
- AE3. Given `prefer agent-browser` and Agent Browser reports `partial`, then `browser-use` falls back only if `fallback_allowed=true`.
- AE4. Given stale Agent Browser capability data, then recovery includes `research_adapter_capability` with bounded Context7 query metadata.
- AE5. Given a static prototype matrix, then it is labeled as research artifact, not runtime source of truth.
- AE6. Given docs research completes without verification, then routing remains failed closed with `research_complete_unverified`.
- AE7. Given an adapter has `full` element actions but incompatible attachment model, then routing fails closed.
- AE8. Given a task needs authenticated state and auth/session is unverifiable, then routing stops before adapter selection.
- AE9. Given any missing required precondition, then no adapter capability report can make the route runnable.
- AE10. Given a task needs authenticated state, then site-specific proof comes from the task, runbook, or durable browser knowledge, not the Browser Adapter.
- AE11. Given docs-only evidence for an adapter capability, then the Router treats it as advisory until verified through a routable report source.
- AE12. Given a capability report has `partial` support, then V1 routing emits recovery or explanation but does not execute real adapter work.
- AE13. Given stale or unknown capability data, then route execution emits `research_adapter_capability` and stops until a verified report refresh exists.
- AE14. Given a human accepts docs-only evidence, then the capability remains unroutable until executable verification refreshes the report.
- AE15. Given a preferred adapter has no current proof, then preference does not make it routable.

## Risks & Dependencies

- Adapter APIs may not expose first-class capability reports yet.
- Static manifest fallback needs strong provenance or it will drift.
- Forced adapter UX can feel strict; recovery copy must be clear.
- Research loops can waste time without stale/terminal controls.
- Capability names must stay precise: `performance_profile` is not `devtools_performance_insight`.
- Manifest-backed V1 can still drift; stale-after and verification are mandatory.
- Adapter registry can overgrow; keep V1 adapter ids fixed until proof paths exist.
- Media proof can expose sensitive data; capture policy must ship with routing.

## Sources

- Prototype: `prototypes/browser-adapter-router/research.html`
- Research stock: `docs/research/2026-06-02-browser-adapter-router-research-stock.md`
- Command-resolution plan: `docs/plans/2026-06-02-003-fix-browser-use-mcporter-command-resolution-plan.md`
- ADR 0012: `docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md`
- ADR 0011: `docs/adr/0011-skill-prose-names-tools-clis-resolve-invocation.md`
- Domain glossary: `CONTEXT.md`
