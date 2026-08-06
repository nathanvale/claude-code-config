---
title: Rewrite Browser Adapter Router clean plan
type: architecture
status: active
date: 2026-06-03
origin: skills/browser-use/docs/plans/2026-06-02-004-design-browser-use-adapter-router-plan.md
supersedes: skills/browser-use/docs/plans/2026-06-02-004-design-browser-use-adapter-router-plan.md
---

# Rewrite Browser Adapter Router clean plan

## Summary

Browser Adapter Router routes a Bounded Browser Outcome by evaluating fresh precondition, attachment, and capability evidence before adapter selection. It is evidence-first: ranking, preference, and registry order only choose among proven candidates. Runtime code owns schemas, validation, capability truth, command discovery, and exact field catalogs; this plan owns policy, acceptance criteria, test intent, and code-check rubric.

## Scope

In scope:

- Keep Router V1 local to `browser-use`.
- Keep `route`, `report`, and `status` as the Router V1 command surface.
- Keep `route` as evidence evaluation only.
- Keep `report` as capability report discovery only.
- Keep `status` as human projection of a supplied evidence envelope.
- Define current accepted policy semantics.
- Define current product JSON semantics at the behavioural level.
- Define acceptance criteria in one readable place.
- Define automated, smoke, and manual verification scenarios.
- Define a follow-up code-check rubric.

Out of scope:

- Do not add `prepare`.
- Do not add `verify`.
- Do not add `report --verify`.
- Do not route from docs-only research.
- Do not route from static prototype matrices.
- Do not put exact schemas in skill prose.
- Do not widen the shared facade with Router-specific policy.
- Do not route degraded or partial support in V1.
- Do not inspect runtime implementation while drafting this plan.

Remaining follow-up:

- Add explicit product evidence/report parent-run correlation.
- Treat smoke artifact `parent_run_id` as test evidence only, not the FU3 product correlation surface.

## Decision History

- ADR 0012 accepted evidence-first routing.
- ADR 0013 accepted research recovery through Router-owned diagnostic detail pointed to by `diagnostic_trail`.
- Follow-up FU1 landed active recovery vocabulary alignment.
- Follow-up FU2 landed route failure `data` for validated route-evaluation failures.
- Follow-up FU3 remains accepted and not landed for product evidence/report correlation.
- Follow-up FU4 landed enriched smoke artifacts.
- Cross-repo facade prerequisite landed generic package-owned `data` envelope support in `side-quest-engineering`.

## Accepted But Deferred

- Product evidence/report parent-run correlation is accepted.
- Route keeps its own `run_id`.
- Reusable evidence may carry explicit `parent_run_id`.
- Same-run-only correlation is rejected because it blocks `report` then `route` workflows.
- Smoke artifact `parent_run_id` is test lineage only.
- Smoke artifact `parent_run_id` does not satisfy product evidence/report correlation.
- No FU3 ADR is needed until implementation reopens meaningful correlation alternatives.
- Command discovery metadata remains artifact-level unless a product need emerges.
- Integrate reusable Router CLI smoke fixture generation and scenario execution into code-owned test utilities.
- Hoist common CLI test helpers and fixture makers into the CLI command facade testing package.
- Add a `cli-author` skill reference that uses prose prompts plus command contracts to generate optional CLI test and fixture coverage.

## Ownership Map

- `browser-use` owns Router policy and product JSON semantics.
- `skills/browser-use/scripts/command-contract.ts` owns command, flag, action, diagnostic, and capability vocabulary.
- Router runtime modules own schemas, validators, manifests, discovery, route engine, recovery projection, and CLI rendering.
- Facade owns generic envelope mechanics, continuation validation, runtime action validation, diagnostic pointers, and package-owned payload allowance.
- Facade does not own Router adapter policy, recovery action ids, report provenance vocabulary, parent-run semantics, or smoke assertions.
- Smoke artifacts are test evidence, not product JSON.
- `skills/browser-use/SKILL.md` owns workflow sequence and tool routing, not exact schemas or capability truth.
- Docs research and prototypes are advisory artifacts, not routable manifests.
- `cli-author` and facade guidance own general CLI drift-prevention rules.
- Router command flags and parser behavior stay package-owned.
- Router tests prove discovery metadata, rendered help, parser acceptance, and runtime semantics align.

## Policy Semantics

- `auto` selects only candidates with fresh, full, compatible evidence.
- `auto` skips missing-proof candidates and records recovery evidence.
- `auto` uses task ranking before registry ranking.
- Registry ranking breaks otherwise equal candidates.
- Route confidence breaks ties after task and registry priority.
- Lexicographic adapter id is the final deterministic tie-break.
- `prefer` evaluates the preferred adapter first.
- `prefer` may fall back only when `fallback_allowed=true`.
- `prefer` with fallback disabled fails closed when the preferred adapter is not fully evidenced.
- `force` evaluates only the forced adapter.
- `force` never falls back.
- Forced alternatives are informational only.
- `minimum_support` defaults to `full`.
- `partial` does not route in V1.
- `allow_degraded` does not route in V1.
- Explicit required capabilities may narrow a task bundle.
- Bundle names are presets; resolved required capabilities drive routing.
- No weighted capability scoring exists in V1.

## Evidence And Report Semantics

- `route` accepts caller-supplied route evidence through an envelope path, stdin JSON, or env JSON.
- `route` does not read implicit latest proof, report, route, or smoke files.
- `route` validates evidence before adapter ranking.
- Missing, unreadable, malformed, or schema-invalid evidence emits `route_evidence_invalid`.
- Stale or mixed-run evidence fails as a validated route-evaluation failure.
- `route_evidence_invalid` emits no Route Validity constraint.
- `route_evidence_invalid` emits no route decision `data`.
- Warm Chrome readiness is checked before adapter capability ranking.
- Attachment proof is required before routing.
- Auth/session readiness is a task precondition, not an adapter capability.
- Target origin/page evidence is required when the task declares that precondition.
- Adapter capability cannot override missing preconditions.
- Capability reports support `full`, `partial`, `none`, `unknown`, and `stale`.
- Capability reports require provenance.
- Capability reports require per-capability confidence.
- Capability reports require per-capability `verification_method` evidence.
- Capability reports require `attachment_model`.
- Manifest reports are validated through the same validator as adapter self-reports.
- Valid self-report overrides manifest.
- Invalid self-report fails closed as `adapter_capability_unknown` with schema diagnostics.
- Stale self-report does not fall back to manifest.
- Missing report emits `adapter_capability_unknown`.
- Stale report emits `adapter_capability_stale`.
- Confidence below threshold fails closed.
- Docs research remains advisory and below the route threshold.

## Product JSON Semantics

- Route success emits selected adapter, ranking/provenance, candidate decisions, Route Validity constraints, and `evaluation_date`.
- Route success emits `use_selected_browser_adapter` as `continuation.next_action_id`.
- Route success is valid for one Bounded Browser Outcome.
- Route success requires reroute when task bundle, target origin/page, selected adapter, proof, capability evidence, or preconditions change or expire.
- Validated route failure emits `data.failure_kind`.
- Validated route failure emits `data.required_capabilities`.
- Validated route failure emits `data.routing_started`.
- Validated route failure emits `data.candidate_decisions`.
- Validated route failure emits `data.informational_alternatives`.
- Validated route failure emits `data.evaluation_date`.
- Validated route failure emits compact research pointer only when research exists.
- Validated route failure does not embed full bounded research detail.
- `route_evidence_invalid` emits no route decision `data`.
- Media proof metadata is `browser-use` owned and run-scoped.
- Smoke artifact fields stay separate from product JSON.

## Recovery Semantics

- Every route failure emits one canonical `continuation.next_action_id`.
- `runtime_actions` includes that canonical action.
- Route success and validated route failure emit Route Validity constraints.
- Research recovery uses `diagnostic_trail`.
- Research signal is advisory and below route threshold.
- `adapter_capability_none` maps to changing route input.
- `adapter_capability_unknown` maps to research adapter capability.
- `adapter_capability_stale` maps to research adapter capability.
- `adapter_capability_partial` maps to `change_route_input` in V1.
- `adapter_attachment_unverified` maps to proving adapter attachment.
- `adapter_attachment_incompatible` maps to changing route input.
- `auth_session_unverified` maps to `verify_auth_session`.
- `target_origin_unverified` maps to `verify_target_origin`.
- `accept_partial_adapter` is inactive in V1.
- `maintainer_verified_manifest` is routable manifest verification.
- Docs review is research/advisory, not routable verification.

## Acceptance Criteria

### Command Contract

- Given Router V1, when command discovery runs, then `route`, `report`, and `status` are exposed.
- Given Router V1, when command discovery runs, then `prepare` is absent.
- Given Router V1, when command discovery runs, then `verify` is absent.
- Given `report`, when help and parser paths are checked, then `--verify` is absent.
- Given command metadata, when rendered help, parser acceptance, and runtime semantics are compared, then advertised flags and accepted flags align.
- Given `--version --json`, when output is emitted, then stdout is a parseable JSON success envelope with `data.name` and `data.version`.
- Given `--version` without `--json`, when output is emitted, then stdout remains plain human version text.
- Given `route`, when command-specific flags are inspected, then only envelope and output flags are exposed.
- Given `status`, when command-specific flags are inspected, then only envelope and output flags are exposed.
- Given `report`, when command-specific flags are inspected, then only adapter, capability, and output flags are exposed.

### Evidence Input

- Given an envelope path, when `route` runs, then it consumes the file as route evidence.
- Given stdin JSON, when `route` runs, then it consumes stdin as route evidence.
- Given env JSON, when `route` runs, then it consumes env JSON as route evidence.
- Given no supplied evidence, when `route` runs, then it fails closed without reading implicit latest files.
- Given missing evidence, when `route` runs, then it emits `route_evidence_invalid`.
- Given unreadable evidence, when `route` runs, then it emits `route_evidence_invalid`.
- Given malformed evidence JSON, when `route` runs, then it emits `route_evidence_invalid`.
- Given schema-invalid evidence, when `route` runs, then it emits `route_evidence_invalid`.
- Given stale route evidence, when `route` runs, then it emits `route_evidence_stale`.
- Given mixed unrelated run evidence, when `route` runs, then it emits `route_evidence_mixed_run`.
- Given stale route evidence, when JSON is emitted, then Route Validity constraints appear.
- Given stale route evidence, when JSON is emitted, then route decision `data` appears.
- Given mixed unrelated run evidence, when JSON is emitted, then Route Validity constraints appear.
- Given mixed unrelated run evidence, when JSON is emitted, then route decision `data` appears.
- Given `route_evidence_invalid`, when JSON is emitted, then no Route Validity constraint appears.
- Given `route_evidence_invalid`, when JSON is emitted, then no route decision `data` appears.

### Capability Reports

- Given a capability report, when validation runs, then `full`, `partial`, `none`, `unknown`, and `stale` are accepted support states.
- Given a capability report without provenance, when validation runs, then it fails closed.
- Given a capability report without per-capability confidence, when validation runs, then it fails closed.
- Given a capability report without per-capability `verification_method` evidence, when validation runs, then it fails closed.
- Given a capability report without `attachment_model`, when validation runs, then it fails closed.
- Given a manifest report, when it is loaded, then it uses the same validator as self-reports.
- Given a valid self-report and manifest, when report discovery runs, then self-report wins.
- Given an invalid self-report and valid manifest, when report discovery runs, then the invalid self-report fails closed and does not fall back.
- Given a stale self-report and valid manifest, when report discovery runs, then the stale self-report fails closed and does not fall back.
- Given no valid report, when routing evaluates the adapter, then it emits `adapter_capability_unknown`.
- Given a stale valid report, when routing evaluates the adapter, then it emits `adapter_capability_stale`.
- Given confidence below threshold, when routing evaluates the adapter, then it fails closed.

### Routing Policy

- Given `auto`, when multiple fully evidenced candidates exist, then task ranking wins first.
- Given `auto` and equal task priority, when registry priority differs, then registry ranking wins.
- Given `auto` and equal task/registry priority, when confidence differs, then confidence wins.
- Given `auto` and equal ranking/confidence, when adapter ids differ, then lexicographic adapter id wins.
- Given `auto`, when a candidate lacks proof, then that candidate is skipped with recovery evidence.
- Given `auto`, when no candidate is fully evidenced, then no adapter is selected.
- Given `prefer` and valid preferred adapter, when routing runs, then the preferred adapter is selected.
- Given `prefer` and invalid preferred adapter with `fallback_allowed=true`, when another candidate is fully evidenced, then fallback may select that candidate.
- Given `prefer` and invalid preferred adapter with `fallback_allowed=false`, when another candidate is fully evidenced, then routing fails closed.
- Given `force`, when the forced adapter is invalid, then routing fails closed.
- Given `force`, when another adapter is fully evidenced, then that adapter is informational only.
- Given `partial` support, when V1 routing evaluates, then no success route is emitted.
- Given `allow_degraded=true`, when V1 routing evaluates, then no success route is emitted from degraded support.
- Given explicit required capabilities, when a task bundle resolves, then those capabilities narrow the runnable candidate set.

### Preconditions

- Given missing Warm Chrome readiness, when routing evaluates, then adapter ranking does not start.
- Given missing attachment proof, when routing evaluates, then `adapter_attachment_unverified` is emitted.
- Given incompatible attachment model, when routing evaluates, then `adapter_attachment_incompatible` is emitted.
- Given task-required auth/session evidence is missing, when routing evaluates, then `verify_auth_session` is the continuation.
- Given task-required target origin evidence is missing or mismatched, when routing evaluates, then `verify_target_origin` is the continuation.
- Given strong adapter capability evidence and missing task preconditions, when routing evaluates, then adapter capability does not override precondition failure.

### Product JSON

- Given route success, when JSON is emitted, then selected adapter is present.
- Given route success, when JSON is emitted, then ranking/provenance is present.
- Given route success, when JSON is emitted, then candidate decisions are present.
- Given route success, when JSON is emitted, then Route Validity constraints are present.
- Given route success, when JSON is emitted, then `evaluation_date` is present.
- Given validated route failure, when JSON is emitted, then `data.failure_kind` is present.
- Given validated route failure, when JSON is emitted, then `data.required_capabilities` is present.
- Given validated route failure, when JSON is emitted, then `data.routing_started` is present.
- Given validated route failure, when JSON is emitted, then `data.candidate_decisions` is present.
- Given validated route failure, when JSON is emitted, then `data.informational_alternatives` is present.
- Given validated route failure with research, when JSON is emitted, then compact research pointer is present.
- Given validated route failure with research, when JSON is emitted, then full bounded research detail is not embedded.
- Given `route_evidence_invalid`, when JSON is emitted, then route decision `data` is absent.
- Given media proof requested, when route succeeds, then media proof metadata is run-scoped and `browser-use` owned.

### Recovery

- Given any route failure, when JSON is emitted, then exactly one canonical `continuation.next_action_id` is present.
- Given any route failure, when JSON is emitted, then the canonical next action exists in `runtime_actions`.
- Given route success, when JSON is emitted, then `use_selected_browser_adapter` exists in `runtime_actions`.
- Given route success or validated route failure, when JSON is emitted, then Route Validity constraints are present.
- Given stale or unknown capability data, when recovery is emitted, then `research_adapter_capability` is used.
- Given research recovery, when JSON is emitted, then bounded research detail is behind `diagnostic_trail`.
- Given partial capability support, when V1 recovery is emitted, then `change_route_input` is used.
- Given V1 routing, when partial support fails, then `accept_partial_adapter` is not emitted as an active continuation.
- Given docs review only, when routing evaluates, then docs review remains advisory and unroutable.

### Smoke Artifacts

- Given a Router smoke artifact, when it is saved, then schema metadata is present.
- Given a Router smoke artifact, when it is saved, then artifact id is present.
- Given a Router smoke artifact, when it is saved, then parent run id is present.
- Given a Router smoke artifact, when it is saved, then generator command is present.
- Given a Router smoke artifact, when it is saved, then runtime versions are present.
- Given a Router smoke artifact, when it is saved, then script hash is present.
- Given a Router smoke artifact, when it is saved, then evaluation date is present.
- Given a smoke case record, when it is saved, then case kind, intent, input source, expected status, output format, parse status, hashes, byte counts, assertions, and pass/fail state are present.
- Given a smoke case record, when it is saved, then `stdout_bytes` and `stderr_bytes` match the UTF-8 byte length of captured stdout and stderr.
- Given captured command and env/stdin data, when smoke artifacts are saved, then sensitive values are redacted or hashed.
- Given command discovery metadata, when smoke artifacts are saved, then metadata stays artifact-level unless a product need emerges.

## Test Scenarios

Automated unit tests:

- Validate command contract exposes `route`, `report`, and `status`.
- Validate command contract excludes `prepare`, `verify`, and `report --verify`.
- Validate command-specific flags, rendered help, parser acceptance, and runtime semantics align.
- Validate `report` side effects remain check/network only with unit or sentinel coverage.
- Validate `route` does not invoke proof or report commands with unit or sentinel coverage.
- Validate `route` consumes envelope path, stdin JSON, and env JSON.
- Validate `route` rejects missing, unreadable, malformed, schema-invalid, stale, and mixed-run evidence with precise failure kinds.
- Validate `route_evidence_invalid` emits no Route Validity constraint or route decision `data`.
- Validate stale and mixed-run evidence emit Route Validity constraints and route decision `data`.
- Validate report states, provenance, confidence, per-capability `verification_method` evidence, and attachment model.
- Validate manifest and self-report use the same report validator.
- Validate valid self-report override wins.
- Validate invalid or stale self-report does not fall back to manifest.
- Validate `auto`, `prefer`, and `force` semantics.
- Validate ranking order: task, registry, confidence, adapter id.
- Validate partial and degraded support do not route in V1.
- Validate auth/session and target-origin preconditions fail before adapter ranking.
- Validate route success and validated route failure product JSON.
- Validate recovery continuation/action alignment.
- Validate bounded research detail uses `diagnostic_trail`.
- Validate media proof metadata stays run-scoped and `browser-use` owned.

Smoke CLI cases:

- `bar-report-chrome-devtools`: manifest report returns fresh Chrome DevTools capabilities.
- `bar-report-verify-rejected`: `report --verify` is rejected by the parser.
- `bar-auto-route-chrome-devtools`: auto route selects fully evidenced Chrome DevTools.
- `bar-status-same-decision`: status projects the same decision as route.
- `bar-missing-adapter-proof`: missing proof fails closed.
- `bar-stale-route-evidence`: stale route evidence fails before ranking.
- `bar-force-no-fallback`: forced adapter never falls back.
- `bar-partial-capability-fail-closed`: partial support fails closed in V1.
- `bar-auth-session-unverified`: auth/session precondition outranks capability.
- `bar-mixed-run-evidence`: mixed-run evidence fails closed.
- `bar-prefer-fallback-allowed`: prefer falls back when allowed.
- `bar-prefer-fallback-disabled`: prefer blocks fallback when disabled.
- `bar-task-ranking-wins`: task ranking beats registry ranking.
- `bar-registry-ranking-tiebreak`: registry ranking breaks equal candidates.
- `bar-extra-required-capability`: explicit capability narrows bundle.
- `bar-unknown-bundle`: unknown bundle fails closed.
- `bar-unknown-required-capability`: unknown required capability fails closed.
- `bar-warm-chrome-not-ready`: missing Warm Chrome precondition fails closed.
- `bar-target-origin-mismatch`: target origin mismatch fails closed.
- `bar-attachment-incompatible`: incompatible attachment model fails closed.
- `bar-capability-none`: `none` support fails closed.
- `bar-capability-unknown`: unknown support triggers research.
- `bar-capability-stale`: stale report triggers research.
- `bar-low-confidence-full-support`: low confidence fails closed.
- `bar-media-proof-metadata`: media proof metadata stays Router-owned.
- `bar-envelope-file-input`: envelope path input works.
- `bar-env-envelope-input`: env envelope input works.
- `bar-missing-envelope-input`: missing evidence fails closed.
- `bar-implicit-latest-files-ignored`: planted latest-looking files are not consumed as route evidence.
- `bar-malformed-envelope-json`: malformed JSON fails closed.
- `bar-report-malformed-self-report`: malformed self-report fails closed.
- `bar-report-self-report-priority`: valid self-report overrides manifest.

Manual/test-matrix cases:

- Run Browser Adapter Proof live cases when dependency/config state changes.
- Run Warm Chrome live cases when preflight or attachment semantics change.
- Confirm Router skill prose names workflow and does not hardcode capability truth.
- Confirm prototype and research files label static capability data as advisory.
- Confirm smoke artifacts are inspectable and redacted.

Missing or remaining scenarios:

- Product evidence/report parent-run correlation after FU3 lands.
- Any future degraded routing contract.
- Any future executable capability verification command.
- Any future operator-selected recovery flow that affects Router semantics.

## Verification Plan

Plan-only rewrite checks:

- Confirm this file uses repo-relative paths only.
- Confirm acceptance criteria are grouped and not duplicated across implementation history.
- Confirm exact schemas are left to runtime code/tests.
- Confirm source links remain concise.
- Confirm the old plan remains untouched.

Code-check commands after this plan exists:

- Inspect Router runtime modules against this plan.
- Inspect Router tests against acceptance criteria.
- Inspect no-internal-invocation claims through unit/sentinel tests and call-path review.
- Inspect command discovery, help, parser acceptance, and runtime semantics together.
- Inspect smoke artifacts and `skills/router-cli-smoke/` against smoke artifact criteria.
- Run focused Router typecheck and tests.
- Run Router smoke only after code or smoke expectations change.

Code-check rubric:

- `implemented and tested`: runtime behaviour exists and has direct coverage.
- `implemented but weakly tested`: runtime behaviour exists but coverage is indirect or brittle.
- `plan says yes, code says no`: acceptance criterion lacks implementation.
- `code has extra behavior not in plan`: runtime behaviour exceeds accepted policy.
- `absence claim without sentinel`: no-side-effect or no-internal-invocation claim lacks a direct guard.
- `plan ambiguity`: criterion is unclear, conflicting, or too schema-specific for prose.

## Source Map

- Old plan: `skills/browser-use/docs/plans/2026-06-02-004-design-browser-use-adapter-router-plan.md`
- ADR 0012: `docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md`
- ADR 0013: `docs/adr/0013-router-research-recovery-uses-diagnostic-trail.md`
- Recovery metadata follow-up: `skills/browser-use/docs/plans/2026-06-03-001-refactor-router-recovery-metadata-plan.md`
- Command flag follow-up: `skills/browser-use/docs/plans/2026-06-03-002-refactor-router-command-flag-contract-plan.md`
- Facade recovery choices follow-up: `docs/plans/2026-06-03-003-feat-facade-operator-recovery-choices-plan.md`
- Research stock: `skills/browser-use/docs/research/2026-06-02-browser-adapter-router-research-stock.md`
- Prototype: `prototypes/browser-adapter-router/research.html`
- Test matrix: `skills/browser-use/TEST_MATRIX.md`
- Cross-repo facade prerequisite: `side-quest-engineering` commit `00e4db4d`
