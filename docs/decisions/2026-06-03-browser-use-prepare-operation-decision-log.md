---
title: Browser Use Prepare And Operation Decision Log
type: decision-log
status: in-progress
date: "2026-06-03"
timezone: Australia/Melbourne
owner: skills/browser-use
source: /var/folders/_b/0fxx_szx34qchf5vq6j5xd1h0000gn/T/browser-use-prepare-operation-handoff.md
decision_metadata_format: fenced-yaml-per-decision
---

# Browser Use Prepare And Operation Decision Log

Use this log for decisions made during the browser-use ergonomics RCA, Route Evidence Preparation, and Browser Operation Front Door grill.

## Decision 1: Runtime Preparation Owner

```yaml
id: browser-use-prepare-operation-001
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should Route Evidence Envelope assembly become a runtime-owned CLI surface?
  option: 1
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-router
  - route-evidence-preparation
durability:
  current: decision-log
  escalate_to_plan: true
  escalate_to_adr: true
evidence:
  - smoke-test consumer had to read browser-adapter-router-model.ts to assemble route evidence
  - route --help named --envelope but did not expose a CLI-owned evidence on-ramp
  - static examples risk becoming shadow contracts
```

Decision:

- Add `prepare` as the runtime-owned Route Evidence Preparation surface.
- Keep `route` as pure evaluation of supplied evidence.
- Put the durable split in the active plan and a tiny ADR.

Rationale:

- Agents should not read TypeScript source types to use a documented command.
- `prepare` can emit prepared evidence or Router Recovery.
- `route` stays evidence-first and does not probe hidden state.

Consequences:

- The active Router V1 plan must reopen the prior "no prepare" constraint.
- `prepare` owns the ergonomic on-ramp from facts to route evidence.
- `route` owns selection from valid supplied evidence.

Next:

- Decision 2 accepted the thin MVP scope.

## Decision 2: Thin Prepare MVP

```yaml
id: browser-use-prepare-operation-002
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What is the smallest PR that satisfies the consumer ergonomics issue?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-router
  - route-evidence-preparation
durability:
  current: decision-log
  escalate_to_plan: true
mvp:
  - plan_update
  - tiny_adr
  - prepare_command_contract
  - prepare_help
  - prepare_success_and_recovery
evidence:
  - docs-only MVP would not solve recoverability
  - full orchestration would make the PR too large
```

Decision:

- Build a thin `prepare` MVP.
- Do not run preflight, proof, or report inside `prepare` in MVP.
- Emit prepared route evidence or structured recovery for missing facts.

Rationale:

- Fix the consumer's "do not make me read TypeScript" problem.
- Prove the seam without building full orchestration.
- Keep the PR reviewable.

Consequences:

- V2 owns orchestration.
- MVP must still be runtime-backed and testable.
- Help must route agents to `prepare`, not source files.

Next:

- Decision 3 accepted the input model.

## Decision 3: Prepare Input Model

```yaml
id: browser-use-prepare-operation-003
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: How should MVP prepare receive evidence?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - route-evidence-preparation
durability:
  current: decision-log
  escalate_to_plan: true
input_model:
  explicit_facts: true
  existing_cli_envelopes: true
  runs_subcommands: false
evidence:
  - explicit raw fields alone remains too low-level
  - running subcommands in MVP risks hiding side effects
  - existing CLI envelopes are already runtime-owned fact sources
```

Decision:

- `prepare` reads existing CLI envelopes plus explicit task and policy facts.
- `prepare` accepts role-specific evidence file flags.
- `prepare` does not run subcommands in MVP.

Rationale:

- Reuse current CLI truth without hidden probing.
- Preserve a clear V2 path where `prepare` can produce evidence itself.
- Keep failures recoverable by missing evidence role.

Consequences:

- Role-specific flags are preferred over one aggregate evidence file.
- V2 can add orchestration without changing route purity.

Next:

- Decision 4 accepted role-specific flags.

## Decision 4: Role-Specific Evidence Flags

```yaml
id: browser-use-prepare-operation-004
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: How should prepare receive existing CLI envelopes?
  option: 1
  confidence: strong
scope: skills/browser-use
owner:
  - route-evidence-preparation
durability:
  current: decision-log
  escalate_to_plan: true
flags:
  - --warm-chrome-proof
  - --adapter-proof
  - --report
policy_flags:
  - --mode
  - --adapter
  - --fallback-allowed
evidence:
  - role-specific flags map directly to missing-fact recovery
  - aggregate evidence file recreates a mini envelope
```

Decision:

- Use role-specific file flags for existing CLI envelopes.
- Use explicit policy and task flags for route intent.

Rationale:

- Missing `--adapter-proof` can map to `prove_adapter_attachment`.
- Missing `--report` can map to capability report discovery.
- Missing `--warm-chrome-proof` can map to Warm Chrome proof.

Consequences:

- `prepare --help` must explain evidence sources.
- Parser and command discovery tests must align with help.

Next:

- Decision 5 accepted success output shape.

## Decision 5: Prepare Success Output

```yaml
id: browser-use-prepare-operation-005
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What should prepare emit on success?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - route-evidence-preparation
durability:
  current: decision-log
  escalate_to_plan: true
success_shape:
  data:
    - envelope
    - route_input_mode
    - next_command_intent
  continuation: route_prepared_evidence
evidence:
  - agents need the next safe action
  - writing files by default would add artifact scope
```

Decision:

- `prepare` success emits the prepared route evidence plus a next action.
- `prepare` does not write a file by default in MVP.
- `route` continues to accept route evidence, not a full `prepare` success envelope.

Rationale:

- Preserve the `route` input seam.
- Give agents the next safe action without widening route input shapes.
- Keep artifact management out of MVP.

Consequences:

- MVP agents manually extract `data.envelope` before invoking `route`.
- V2 tracks pipe-friendly flow and output-file support.

Next:

- Decision 6 accepted prepare-specific recovery vocabulary.

## Decision 6: Prepare Recovery Vocabulary

```yaml
id: browser-use-prepare-operation-006
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What recovery vocabulary should prepare use for missing facts?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - route-evidence-preparation
  - router-recovery
durability:
  current: decision-log
  escalate_to_plan: true
actions:
  - prove_warm_chrome
  - discover_capability_report
  - prove_adapter_attachment
  - change_prepare_input
  - route_prepared_evidence
evidence:
  - reusing change_route_input would preserve old friction
  - free-text next commands weaken runtime-owned recovery
```

Decision:

- Add prepare-specific recovery actions.
- Keep the action set small.
- Use the same runtime action and continuation discipline as Router Recovery.

Rationale:

- Missing facts should name the missing fact and next safe action.
- Agents should not choose from prose.
- The recovery vocabulary should be testable.

Consequences:

- `runtime_actions` must include the canonical continuation.
- Tests must prove action/continuation alignment.
- `change_route_input` remains route evaluation recovery, not preparation recovery.

Next:

- Decision 7 accepted missing-fact aggregation.

## Decision 7: Missing Fact Aggregation

```yaml
id: browser-use-prepare-operation-007
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should prepare fail on first missing fact or collect all missing facts?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - route-evidence-preparation
durability:
  current: decision-log
  escalate_to_plan: true
missing_fact_model:
  collect_all: true
  continuation_strategy: first_safe_dependency_step
dependency_order:
  - prove_warm_chrome
  - discover_capability_report
  - prove_adapter_attachment
  - change_prepare_input
evidence:
  - smoke-test consumer lost calls to incremental discovery
  - full missing facts reduce recovery loops
```

Decision:

- Collect all missing or invalid facts.
- Emit one canonical `continuation.next_action_id` using dependency order.
- Include all relevant recovery actions in `runtime_actions`.

Rationale:

- Preserve one next safe action.
- Avoid hiding other blockers.
- Reduce wasted agent calls.

Consequences:

- `data.missing_facts[]` becomes a package-owned result vocabulary area.
- Same-input retry should be false when inputs are missing or invalid.

Next:

- Decision 8 accepted CLI help ownership.

## Decision 8: CLI Help As Ergonomic On-Ramp

```yaml
id: browser-use-prepare-operation-008
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: How much route and prepare help should show?
  option: route_pointer_and_prepare_sources
  confidence: strong
scope: skills/browser-use
owner:
  - command-contract
  - route-evidence-preparation
durability:
  current: decision-log
  escalate_to_plan: true
help_policy:
  route_help: one_line_prepare_pointer
  prepare_help: usage_flags_and_evidence_sources
  no_full_envelope_example: true
evidence:
  - route help currently says --envelope without an on-ramp
  - full examples risk becoming shadow schemas
  - help can be checked against parser and runtime behavior
```

Decision:

- `route --help` gets a one-line pointer to `prepare --help`.
- `prepare --help` shows usage, role-specific flags, and an Evidence sources block.
- Do not put full route evidence schema or example envelope in help.

Rationale:

- CLI help should route to the owner of the on-ramp.
- Runtime validation owns exact accepted shape.
- Docs own rationale and judgment, not drift-prone command facts.

Consequences:

- Command Surface Alignment Proof must include `prepare`.
- Help should not mention source-type reading.

Next:

- Decision 9 accepted CLI-owned capability summary.

## Decision 9: Capability On-Ramp

```yaml
id: browser-use-prepare-operation-009
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Where should the static capability summary request land?
  option: 3
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-router-report
durability:
  current: decision-log
  escalate_to_plan: true
evidence:
  - static adapter-map capability truth can drift
  - dynamic report is authoritative and freshness-gated
  - report --plain can provide a compact CLI-owned on-ramp
```

Decision:

- Improve `report --plain` as the compact capability summary.
- Keep `report --json` authoritative.
- Do not add a static capability table to the Browser Adapter Map in MVP.

Rationale:

- Prefer runtime-checked CLI ergonomics over static drift-prone docs for command-shaped facts.
- Keep capability truth inside report discovery.
- Keep adapter maps focused on proof, repair, and debug guidance.

Consequences:

- V2 may add richer report/status views if plain output gets dense.
- Static capability docs should be generated or mechanically checked if added later.

Next:

- Decision 10 accepted scoped startup guardrails.

## Decision 10: Agent-Native Ergonomics Guardrails

```yaml
id: browser-use-prepare-operation-010
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should AGENTS.md name ergonomics as first-class for maps and command facts?
  option: 2
  confidence: soft
scope: repo-startup
owner:
  - AGENTS.md
durability:
  current: decision-log
  escalate_to_implementation: true
accepted_bullets:
  - Make maps ergonomic: expose next valid actions without source spelunking.
  - Put drift-prone command facts in runtime-checked CLI help or checks; use docs for rationale and judgment.
evidence:
  - source spelunking caused the bad route-envelope response
  - overly broad "help over docs" wording would be wrong
  - startup instructions should stay terse
```

Decision:

- Add two scoped Agent-Native Work guardrails to `AGENTS.md`.
- Keep the wording scoped to next actions and drift-prone command facts.

Rationale:

- Ergonomics should be visible when agents design maps and CLI surfaces.
- Docs still own rationale and judgment.
- CLI help and checks own drift-prone command facts.

Consequences:

- This is a guardrail, not the primary fix.
- Delivery must still be checked through `scripts/agent-instructions.sh`.

Next:

- Decision 11 accepted the Browser Operation vocabulary split.

## Decision 11: Browser Operation Vocabulary

```yaml
id: browser-use-prepare-operation-011
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should Browser Adapter become internal behind a new public Browser Operation term?
  option: "yes"
  confidence: strong
scope: browser-use-domain-language
owner:
  - CONTEXT.md
durability:
  current: context-glossary
  implemented_in:
    - CONTEXT.md
architecture_lens:
  public_module: Browser Operation
  internal_adapter: Browser Adapter
  seam: browser operation front door
evidence:
  - prior Browser Adapter definition said adapters attach to and operate Warm Chrome
  - that wording made raw adapter buttons look like a skill-driver interface
  - skill driver should not know adapter method names or support-tool transport
```

Decision:

- Add **Browser Operation** as the skill-driver-facing action request.
- Redefine **Browser Adapter** as an internal mechanism behind Browser Operations.
- Update `CONTEXT.md` immediately.

Rationale:

- The seam should hide native MCP, `mcporter`, Playwright CDP, and tool-specific method args.
- The skill driver asks `browser-use` for operations.
- Adapters implement operations after routing and proof.

Consequences:

- Existing "adapter action" prose needs a glossary consistency sweep.
- Browser Adapter Maps remain proof/repair/debug maps, not the operation interface.

Next:

- Decision 12 accepted a lean Browser Operation Front Door MVP.

## Decision 12: Browser Operation Front Door MVP

```yaml
id: browser-use-prepare-operation-012
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should MVP include a Browser Operation Front Door proof?
  option: 1_then_operations_3
  confidence: strong
scope: skills/browser-use
owner:
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
operations:
  - snapshot
  - screenshot
  - emulate
evidence:
  - raw mcporter calls exposed pageId and resize/emulate details to the skill driver
  - snapshot and screenshot were core smoke-test mechanisms
  - emulate exposed viewport and DPR paper cuts that belong behind the operation seam
```

Decision:

- Add a lean Browser Operation Front Door proof to MVP.
- Include `snapshot`, `screenshot`, and `emulate`.
- Do not add click, type, selector action, network inspection, or artifact management in MVP.

Rationale:

- Fix the deeper abstraction leak, not just the route-envelope ergonomics.
- Prove semantic, visual, and viewport operations behind one front door.
- Keep the operation set small enough for one PR.

Consequences:

- Adapter-map paper-cut notes are not the root fix.
- V2 owns richer operation coverage.

Next:

- Decision 13 accepted CLI ownership for operations.

## Decision 13: Browser Operation CLI Owner

```yaml
id: browser-use-prepare-operation-013
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What command should own Browser Operations?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-use-cli
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
rejected:
  - browser-adapter-router-operate
  - browser-adapter-map-operate
evidence:
  - Router chooses adapters
  - Browser Adapter Map is proof/repair/debug guidance
  - Browser Operations belong to browser-use
```

Decision:

- Add a new `browser-use` CLI surface for Browser Operations.
- Do not put operations under Browser Adapter Router.
- Do not put operations under Browser Adapter Map.

Rationale:

- Preserve owner clarity: Router selects, browser-use operates.
- Avoid making Router a universal browser API.
- Avoid turning maps into execution front doors.

Consequences:

- Route success can carry selected adapter data, but operation execution belongs elsewhere.
- Implementation needs a small browser-use command contract surface.

Next:

- Decision 14 accepted route success as operation input.

## Decision 14: Operation Route Input

```yaml
id: browser-use-prepare-operation-014
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What should operate --route contain?
  option: 1
  confidence: strong
scope: skills/browser-use
owner:
  - browser-operation-front-door
  - browser-adapter-router
durability:
  current: decision-log
  escalate_to_plan: true
input:
  route: full_route_success_envelope
evidence:
  - selected adapter id alone loses Route Validity constraints
  - prepared evidence belongs before route, not operation
```

Decision:

- `operate --route` consumes the full Router success envelope.
- `operate` validates route success and selected adapter data.
- `operate` does not consume prepared route evidence directly.

Rationale:

- Preserve `prepare -> route -> operate`.
- Keep Route Validity available at operation time.
- Avoid rerouting inside operation execution.

Consequences:

- Tests must provide a route success envelope fixture.
- V2 may add route artifact management, but MVP can use file input.

Next:

- Decision 15 accepted Browser Adapter Proof input.

## Decision 15: Operation Attachment Proof Input

```yaml
id: browser-use-prepare-operation-015
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should operate require Browser Adapter Proof evidence too?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-operation-front-door
  - browser-adapter-proof
durability:
  current: decision-log
  escalate_to_plan: true
input:
  adapter_proof: required
evidence:
  - route success selects an adapter but does not prove attachment is still fresh
  - raw adapter operation without proof would violate proof-first design
```

Decision:

- `operate` requires a fresh Browser Adapter Proof envelope in MVP.
- `operate` validates the proof belongs to the selected adapter and verified Warm Chrome.

Rationale:

- Keep the operation chain honest.
- Avoid calling an adapter that is no longer attached.
- Keep Browser Adapter Proof as the attachment owner.

Consequences:

- MVP command shape includes `--route` and `--adapter-proof`.
- V2 may let orchestration produce both inputs.

Next:

- Decision 16 accepted MVP transport implementation.

## Decision 16: MVP Operation Transport

```yaml
id: browser-use-prepare-operation-016
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: For MVP chrome-devtools operations, should operate call native MCP, mcporter, or transport selection?
  option: 1
  confidence: strong
scope: skills/browser-use
owner:
  - browser-operation-front-door
  - chrome-devtools-operation-adapter
durability:
  current: decision-log
  escalate_to_plan_if: accepted
recommended_transport: mcporter_only_for_mvp
v2_candidates:
  - native_mcp_if_available_else_bridge
  - playwright_cdp_operation_adapter
  - agent_browser_operation_adapter
evidence:
  - mcporter caused observed paper cuts when exposed directly
  - using mcporter behind the front door proves the seam hides those cuts
  - native MCP tool access is not a stable repo-owned CLI implementation path
```

Decision:

- Use `mcporter` behind the Browser Operation Front Door for MVP `chrome-devtools`.
- Hide `mcporter` method names, arg names, and support-tool transport from the skill driver.
- Add native MCP transport selection in V2.

Rationale:

- The abstraction should remove `pageId` and `resize_page` paper cuts from the driver.
- `mcporter` is CLI-testable with mocked command execution.
- Native MCP is ideal interactively, but not stable as a repo-owned CLI dependency.

Consequences:

- MVP operation adapter implements `snapshot`, `screenshot`, and `emulate` through `mcporter`.
- Raw `mcporter call` remains degraded/debug, not the driver-facing path.

Next:

- Decision 17 accepted normalized operation output.

## Decision 17: Browser Operation Success Output

```yaml
id: browser-use-prepare-operation-017
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What should operate emit on success?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
success_shape:
  normalized_result: true
  bounded_adapter_diagnostics: true
  raw_adapter_response_primary: false
diagnostics_policy:
  allowlist_required: true
  redact_adapter_handles: true
  redact_sensitive_browser_facts: true
```

Decision:

- Emit normalized Browser Operation results.
- Include bounded adapter diagnostics for debugging.
- Keep raw adapter method names and transport output out of the primary result.

Rationale:

- Agents need inspectable state without learning `mcporter` or native MCP method shapes.
- Debuggability still matters when the adapter behaves oddly.
- Normalized output preserves the Browser Operation front door.

Consequences:

- Success data names operation, adapter, route/proof binding, target source, and operation-specific facts.
- Screenshot output names artifact metadata.
- Adapter diagnostics stay bounded, allowlisted, redacted, and non-authoritative.
- Adapter diagnostics never expose adapter page ids, CDP target ids, session ids, WebSocket debugger URLs, headers, cookies, query strings, fragments, or raw adapter method names.

Next:

- Decision 18 accepted Browser Target vocabulary.

## Decision 18: Browser Target Vocabulary

```yaml
id: browser-use-prepare-operation-018
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What vocabulary names operation-time page/tab choice without leaking adapter ids?
  option: browser_target_vocabulary
  confidence: strong
scope: browser-use-domain-language
owner:
  - CONTEXT.md
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_context: true
terms:
  - Browser Target Candidate
  - Browser Target Hint
  - Browser Target Discovery
  - Browser Target Selection
  - Browser Target Resolution
  - Browser Operation Target
```

Decision:

- Add Browser Target vocabulary.
- Use **Browser Target Candidate** for listed current pages.
- Use **Browser Target Hint** for semantic criteria such as origin, URL substring, or title substring.
- Use **Browser Target Discovery** for listing current candidates.
- Use **Browser Target Selection** for run-scoped current target state.
- Use **Browser Target Resolution** for choosing exactly one candidate for an operation.
- Use **Browser Operation Target** for the internal resolved target passed to the selected Browser Adapter.
- Treat candidate ordinal as a Browser Target Selection input, not a Browser Target Hint.

Rationale:

- Native Chrome DevTools MCP exposes `list_pages`, `select_page`, and selected-page operations.
- `browser-use` should preserve that ergonomic model without exposing adapter `pageId`.
- `target_origin` already means a route precondition; target vocabulary needs operation-time precision.

Consequences:

- Browser Operation Target is live browser state, not durable browser knowledge.
- Candidate ordinals are `browser-use` ordinals inside one candidate envelope, not adapter page ids.
- Adapter handles stay internal.

Next:

- Decision 19 accepted native-feel Browser Target Selection in MVP.

## Decision 19: Browser Target Selection MVP

```yaml
id: browser-use-prepare-operation-019
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should browser-use mirror native Chrome MCP page context ergonomics at its own layer?
  option: 1
  confidence: strong
scope: skills/browser-use
owner:
  - browser-target-discovery
  - browser-target-selection
durability:
  current: decision-log
  escalate_to_plan: true
mvp_commands:
  - targets list
  - targets select
  - targets status
```

Decision:

- Add `browser-use targets list`.
- Add `browser-use targets select`.
- Add `browser-use targets status`.
- Store selected target as run-scoped semantic state.
- Keep adapter page ids out of skill-driver input.

Rationale:

- Native MCP feels good because agents can list pages, select one, then operate against selected context.
- `browser-use` should keep the same mental model while adding provenance and route discipline.
- Per-operation hints alone are safe but less ergonomic than selected context.

Consequences:

- `targets list` emits Browser Target Candidates.
- `targets select` creates run-scoped Browser Target Selection only from route-bound candidates.
- `targets status` shows selected target state only.
- `operate` defaults to selected target state when no per-operation hints are supplied.

Next:

- Decision 20 accepted target discovery modes.

## Decision 20: Browser Target Discovery Modes

```yaml
id: browser-use-prepare-operation-020
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should targets list support route-bound and recovery modes?
  option: 1
  confidence: strong
scope: skills/browser-use
owner:
  - browser-target-discovery
  - route-evidence-preparation
durability:
  current: decision-log
  escalate_to_plan: true
modes:
  route_bound:
    requires:
      - route_success
      - adapter_proof
    operation_ready: true
  recovery:
    requires:
      - requested_adapter
      - adapter_proof
    operation_ready: false
usage:
  route_bound: targets list --mode route-bound --route <path> --adapter-proof <path>
  recovery: targets list --mode recovery --adapter <id> --adapter-proof <path>
```

Decision:

- Support route-bound `targets list`.
- Support recovery-mode `targets list`.
- Require route success plus Adapter Proof for route-bound discovery.
- Require explicit requested adapter plus Adapter Proof for recovery discovery.
- Require recovery discovery to name the requested adapter with `--adapter <id>` and Adapter Proof with `--adapter-proof <path>`.
- Mark recovery candidates as evidence-gathering only.
- Scope recovery candidates to the requested adapter and Adapter Proof that produced them.
- Do not let recovery discovery choose, imply, or authorize a Router-selected adapter.

Rationale:

- Target Discovery can produce route evidence before route success without authorizing operations.
- Target Discovery is read-only inspection, not Browser Operation execution.
- Route-origin recovery may need open-page facts before `prepare` can assemble route evidence.
- Browser Adapter Proof already supports a requested Browser Adapter before Router selection.

Consequences:

- Route-bound output emits `route_bound=true` and `operation_ready=true`.
- Recovery output emits `route_bound=false` and `operation_ready=false`.
- Recovery output continues to `prepare`, not `targets select` or `operate`.
- `targets select` rejects recovery-mode candidate output.
- `prepare` may consume recovery-mode target discovery as target precondition evidence.
- `prepare` preserves recovery target adapter/proof binding and rejects it when policy or selected-route evidence cannot reconcile it.
- If `route` later selects a different adapter, route-bound Target Discovery must rerun.

Next:

- Decision 21 accepted operation target resolution sources.

## Decision 21: Operation Target Resolution Sources

```yaml
id: browser-use-prepare-operation-021
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: How should operate choose the Browser Operation Target?
  option: selected_state_with_hint_override_and_single_candidate_default
  confidence: strong
scope: skills/browser-use
owner:
  - browser-target-resolution
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
resolution_order:
  - per_operation_hint
  - selected_target_state
  - exactly_one_candidate
supplied_candidates:
  flag: --targets
  accepted_shape: full_targets_list_success_envelope
  freshness: same_run_plus_short_ttl
candidate_source:
  implicit_default: route_bound_target_discovery
  fixture_replay: dry_run_only
operation_authorization:
  validate_intent_against_route: true
```

Decision:

- Let every MVP Browser Operation accept optional Browser Target Hints.
- MVP Browser Target Hints are operation-time origin, URL substring, and title substring.
- Use per-operation hints over selected target state.
- Use selected target state when no hints are supplied.
- Auto-resolve when exactly one candidate exists.
- Let `operate --targets <path>` consume a full `targets list` success envelope for deterministic replay, tests, and debugging.
- Fail when multiple candidates exist and no selected state or unique hints exist.
- Let `operate` run route-bound Browser Target Discovery internally for the exactly-one-candidate fallback when no `--targets` or selected state exists.
- Validate operation intent against route success and selected adapter capability before acting.

Rationale:

- Explicit command input should beat ambient state.
- Single-page default keeps trivial cases ergonomic.
- Multi-page ambiguity should fail recoverably rather than silently acting on the wrong tab.
- Full target envelopes preserve candidate provenance and avoid shadow contracts.
- Route success should authorize the requested operation class, not just any operation on the selected adapter.

Consequences:

- Output records target source such as `hint_override`, `selected_state`, or `single_candidate`.
- Ambiguous hints fail with a refine-target recovery.
- Selected state is not fallback when hints were supplied and failed.
- `operate --targets` rejects bare candidate arrays and adapter target ids.
- Supplied targets must match the operation run and short freshness window.
- Live `operate --targets` stays freshness-gated.
- Fixture replay uses dry-run/mock-only target resolution so tests do not weaken live freshness.

Next:

- Decision 22 accepted target selection input and state rules.

## Decision 22: Target Selection Input And State

```yaml
id: browser-use-prepare-operation-022
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What input and state rules make targets select ergonomic without hidden adapter handles?
  option: route_bound_envelope_plus_ordinal_or_hints
  confidence: strong
scope: skills/browser-use
owner:
  - browser-target-selection
durability:
  current: decision-log
  escalate_to_plan: true
state:
  scope: run
  storage: explicit_state_file_or_run_id_derived_path
  adapter_page_id_public_input: false
  ttl: short
  file_mode: "0600"
  atomic_write: true
  concurrent_write_policy: fail_on_conflict
```

Decision:

- `targets select` accepts a full `targets list` success envelope.
- Selection uses either a `browser-use` candidate ordinal or Browser Target Hints.
- Candidate ordinal means ordinal inside that envelope, not adapter `pageId`.
- Ambiguous hints fail with `refine_target_hint`.
- Selected target state is run-scoped semantic state.
- Stored selection requires route/proof binding.
- Stored selection requires explicit `--state <path>` or a deterministic `BROWSER_USE_TARGET_STATE` / `BROWSER_USE_RUN_ID` derived path.
- Stored selection includes run id, route/proof binding, target envelope id, created time, expiry time, selected candidate id, and redacted display facts.

Rationale:

- Ordinals are ergonomic after listing.
- Hints are ergonomic for scripted flows.
- The full envelope preserves provenance, freshness, route binding, and candidate meaning.
- Explicit state paths keep retries and concurrent agents from sharing ambient target state by accident.

Consequences:

- `targets select` does not use implicit latest list state.
- `targets select` does not re-list and reinterpret an ordinal against a changed candidate set.
- `operate` fails with `refresh_target_selection` when selected state does not match current route/proof.
- Selection state stays valid across MVP `snapshot`, `screenshot`, and viewport `emulate`.
- Navigation invalidates selection state when navigation operations enter scope.
- `targets status` fails clearly when state is missing, stale, unreadable, or bound to another run.

Next:

- Decision 23 accepted focus side-effect rules.

## Decision 23: Focus Side Effects

```yaml
id: browser-use-prepare-operation-023
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Which target and operation commands may bring a page to front?
  option: explicit_focus_only
  confidence: strong
scope: skills/browser-use
owner:
  - browser-target-selection
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
focus_policy:
  targets_select: optional_bring_to_front
  operate_screenshot: optional_bring_to_front
  operate_snapshot: never_in_mvp
  operate_emulate: optional_bring_to_front
```

Decision:

- `targets select` does not bring the page to front by default.
- `targets select` supports explicit `--bring-to-front`.
- `operate screenshot` does not bring the page to front by default.
- `operate screenshot` supports explicit `--bring-to-front`.
- `operate snapshot` never brings the page to front in MVP.
- `operate emulate` does not bring the page to front by default.
- `operate emulate` supports explicit `--bring-to-front`.

Rationale:

- Focus is a browser side effect.
- Snapshot should stay boring read-only semantic inspection.
- Visual workflows still need an explicit focus escape hatch.

Consequences:

- Browser focus changes are never implicit in target selection.
- Browser focus changes are visible in command flags and operation diagnostics.

Next:

- Decision 24 accepted MVP operation options.

## Decision 24: MVP Operation Options

```yaml
id: browser-use-prepare-operation-024
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What operation options stay in MVP?
  option: bounded_native_like_subset
  confidence: strong
scope: skills/browser-use
owner:
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
operations:
  snapshot:
    verbose: optional
    out_required: false
    sensitivity: browser_content
    bounds:
      - max_nodes
      - max_bytes
  screenshot:
    out_required: true
    full_page: optional
    element_uid: deferred
    artifact_scope: run_scoped
  emulate:
    viewport_only: true
    flags:
      - width
      - height
      - dpr
      - mobile
      - touch
      - landscape
```

Decision:

- MVP Browser Operations are `snapshot`, `screenshot`, and viewport `emulate`.
- `operate snapshot` emits normalized snapshot data to JSON stdout.
- `operate snapshot` supports optional `--verbose`.
- `operate snapshot` treats stdout as sensitive browser content.
- `operate snapshot` has default node/byte bounds and emits truncation metadata.
- `operate screenshot` requires `--out <path>`.
- `operate screenshot` supports optional `--full-page`.
- `operate screenshot` writes inside a run-scoped artifact root by default.
- Defer element screenshots by snapshot uid.
- `operate emulate` covers viewport only.
- Use separate viewport flags: `--width`, `--height`, `--dpr`.
- Add optional device-style flags: `--mobile`, `--touch`, `--landscape`.

Rationale:

- MVP should hide current viewport, DPR, resize, and snapshot paper cuts.
- Screenshot artifacts should not become giant JSON or log payloads.
- UID-based element screenshots need snapshot freshness rules and should wait.

Consequences:

- Full native MCP emulation remains V2.
- Snapshot output is normalized, not raw adapter text.
- Screenshot output is artifact metadata plus bounded diagnostics.
- Screenshot artifacts use owner-only permissions, avoid image bytes/base64 in JSON or logs, and emit redacted URL/title metadata only.
- Snapshot full-content/debug output requires explicit flags and keeps values/URLs redacted by default.

Next:

- Decision 25 accepted target safety and privacy rules.

## Decision 25: Target Safety And Privacy

```yaml
id: browser-use-prepare-operation-025
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: How should target listing expose URLs and fingerprints safely?
  option: redacted_shape_and_safe_fingerprint
  confidence: strong
scope: skills/browser-use
owner:
  - browser-target-discovery
durability:
  current: decision-log
  escalate_to_plan: true
privacy:
  show_url_default: false
  show_url_displays_raw_path: false
  show_url_strips_query_and_fragment: true
fingerprint_fields:
  - origin
  - path_shape_or_run_local_hash
  - title_shape
  - browser_use_candidate_id
```

Decision:

- `targets list` redacts URL shape by default.
- `targets list --show-url` may show origin and redacted path shape.
- `targets list --show-url` still strips query strings and fragments.
- Candidate fingerprints use safe stable-ish fields: origin, path shape or run-local hash, title shape, and a `browser-use` candidate id.
- Candidate ordinal is a selector inside one candidate envelope, not part of the fingerprint.
- Machine evidence and display output are separate: display stays redacted; proof-bound evidence may carry exact matching facts only inside runtime-owned envelopes.

Rationale:

- Auth-bearing URLs can leak tokens, session identifiers, or private query data.
- Sensitive facts can live in path segments, not only query strings and fragments.
- Origin alone is too weak for same-origin tabs.
- Adapter page ids are tempting but leak transport state.

Consequences:

- Full URL display is not in MVP.
- Fingerprints are drift detectors, not durable identity.
- Candidate ordinals are scoped to the current candidate envelope.
- `prepare` consumes runtime-owned target evidence, not lossy display text.

Next:

- Decision 26 accepted `prepare` target recovery boundaries.

## Decision 26: Prepare And Target Recovery Boundary

```yaml
id: browser-use-prepare-operation-026
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What should prepare know about Browser Targets?
  option: accept_target_facts_without_running_discovery
  confidence: strong
scope: skills/browser-use
owner:
  - route-evidence-preparation
  - browser-target-discovery
durability:
  current: decision-log
  escalate_to_plan: true
prepare_target_policy:
  runs_target_discovery: false
  consumes_recovery_targets: true
  consumes_route_bound_targets: false
  target_discovery_flag: --target-discovery
```

Decision:

- `prepare` may accept target precondition facts.
- `prepare` does not run Browser Target Discovery.
- `prepare` may consume recovery-mode `targets list` output as target precondition evidence.
- `prepare` does not consume route-bound `targets list` output.
- `prepare` accepts recovery-mode target discovery through `--target-discovery <path>`.
- `prepare` maps recovery target evidence to route preconditions without treating display-safe target text as authorization-grade truth.
- `prepare` preserves adapter/proof provenance from recovery-mode target discovery.
- `prepare` does not create selected target state or operation-ready candidates.

Rationale:

- `prepare` is evidence assembly, not hidden browser probing.
- Recovery-mode Target Discovery closes the target-origin evidence loop.
- Route-bound target output occurs after route success and should not feed back into initial preparation.

Consequences:

- Recovery flow can be `adapter proof -> targets list recovery -> prepare -> route`.
- Route-bound flow can be `route -> targets list -> targets select -> operate`.
- No circular route-bound target evidence in MVP.
- Empty, ambiguous, stale, or adapter-mismatched target discovery emits prepare recovery instead of route evidence.
- Recovery target evidence cannot be reused after `route` selects a different adapter.

Next:

- Decision 27 accepted CLI ownership.

## Decision 27: CLI Ownership

```yaml
id: browser-use-prepare-operation-027
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should prepare and operate/targets live under one CLI or two?
  option: 1
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-router
  - browser-use-cli
durability:
  current: decision-log
  escalate_to_plan: true
cli_surfaces:
  browser-adapter-router:
    - prepare
    - route
    - report
    - status
  browser-use:
    - targets
    - operate
contract_owner:
  - skills/browser-use/scripts/command-contract.ts
create_cli_required: true
```

Decision:

- Keep Router surfaces under `browser-adapter-router`.
- Add live browser target and operation surfaces under `browser-use`.
- Do not put Browser Operations under Browser Adapter Router.

Rationale:

- Router owns evidence preparation and route evaluation.
- `browser-use` owns live browser target and operation surfaces.
- One CLI for everything would blur Router versus Operation ownership.

Consequences:

- MVP has two CLIs.
- Skill workflow uses `browser-adapter-router prepare -> route`, then `browser-use targets/operate`.
- Command-contract tests must prove both CLI surfaces.
- New and changed CLI surfaces follow `create-cli`.
- Help, command discovery, parser acceptance, and runtime semantics are mechanically checked for both CLIs.

Next:

- Decision 28 accepted the implementation milestone split.

## Decision 28: MVP Milestone Split

```yaml
id: browser-use-prepare-operation-028
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: How should the enlarged MVP stay reviewable?
  option: milestone_split
  confidence: strong
scope: skills/browser-use
owner:
  - route-evidence-preparation
  - browser-use-cli
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
milestones:
  - prepare_route_on_ramp
  - route_proof_binding
  - browser_use_cli_contract_shell
  - shared_mcporter_transport_runner
  - target_discovery_recovery
  - route_bound_target_selection
  - operation_front_door
```

Decision:

- Split implementation into milestones.
- Keep each milestone independently reviewable.
- Do not ship target selection or operations before route/proof binding exists.
- Do not treat the accepted decisions as one PR.
- Put `prepare`, `browser-use` CLI contract shell, shared `mcporter` transport, Target Discovery/Selection, Browser Operations, and docs/tests behind separate gates.

Rationale:

- The work is no longer the thin `prepare` MVP alone.
- Target state, operation execution, privacy, and route evidence each carry separate failure modes.
- Milestones preserve the accepted architecture without turning one PR into a pile-up.

Consequences:

- `ce-plan` must sequence milestones and identify test gates per milestone.
- The first milestone can still deliver `prepare`.
- The `browser-use` CLI shell can land before live operations when contracts, help, parser acceptance, and dry-run behavior are proven.
- Later milestones can add `browser-use targets` and `operate` only after their binding and privacy gates pass.

Next:

- Decision 29 accepted canonical binding identity.

## Decision 29: Route Proof Target Binding

```yaml
id: browser-use-prepare-operation-029
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What identity proves route, proof, target, and operation belong together?
  option: canonical_binding_tuple
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-router
  - browser-target-discovery
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
binding_tuple:
  - run_id
  - warm_chrome_run_id
  - warm_chrome_proof_id
  - adapter_proof_id
  - selected_adapter_id
  - route_success_id_or_hash
  - route_evidence_hash
  - target_envelope_id
  - target_candidate_id
  - operation_intent_id_or_class
  - emitted_at
  - expires_at
```

Decision:

- Define one canonical binding tuple for route/proof/target/operation validation.
- Route success must expose enough binding metadata for `operate` to validate the supplied Adapter Proof.
- Target discovery and target selection must carry the same binding vocabulary.
- Browser Operation authorization validates operation intent against route success, selected adapter capability, and route evidence capability.
- A route prepared only for `snapshot` does not authorize `screenshot` or `emulate` unless the route evidence proves those operation classes.

Rationale:

- Adapter id alone cannot prove a proof is the attachment evidence a route evaluated.
- Freshness, route validity, target state, and operation authorization need comparable identity fields.
- Runtime checks beat filename or timestamp inference.

Consequences:

- Route success or operation input must include route/proof binding metadata in MVP.
- Mismatch tests cover each binding field.
- Capability mismatch tests cover `snapshot`, `screenshot`, and `emulate`.
- `operate` fails closed on missing, stale, or mismatched binding.

Next:

- Decision 30 accepted operation recovery contracts.

## Decision 30: Browser Operation Recovery Contracts

```yaml
id: browser-use-prepare-operation-030
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What recovery vocabulary should targets and operate own?
  option: package_owned_runtime_actions
  confidence: strong
scope: skills/browser-use
owner:
  - browser-target-discovery
  - browser-target-selection
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
actions:
  - supply_route_success
  - supply_adapter_proof
  - refresh_adapter_proof
  - refresh_targets
  - choose_target_candidate
  - refine_target_hint
  - refresh_target_selection
  - rerun_route_bound_target_discovery
  - change_operation_input
  - inspect_operation_diagnostics
  - rerun_snapshot_with_filter
```

Decision:

- Add package-owned Browser Target and Browser Operation diagnostic codes.
- Add runtime actions and one canonical continuation per failure.
- Keep recovery semantics in runtime contracts and tests, not prose-only decisions.
- Use recovery target discovery only as evidence before routing; use route-bound target discovery for operation-ready candidates.

Rationale:

- Missing route, missing proof, empty candidates, ambiguous hints, stale state, transport failure, unparsable output, and artifact write failure need structured recovery.
- Existing Router recovery already proves this pattern.

Consequences:

- Every nonzero JSON error emits `error.code`, `runtime_actions[]`, and `continuation.next_action_id`.
- Recovery action/continuation alignment gets runtime validation.
- Plain output names the same action id.
- Empty, ambiguous, stale, recovery-mode, or adapter-mismatched target discovery output never silently falls through to operation execution.

Next:

- Decision 31 accepted CLI on-ramp and output contract gates.

## Decision 31: Agent-Ready CLI Contract Gates

```yaml
id: browser-use-prepare-operation-031
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What gates prevent the new CLIs from becoming prose-only wrappers?
  option: runtime_contract_and_help_gates
  confidence: strong
scope: skills/browser-use
owner:
  - browser-use-cli
  - command-contract
durability:
  current: decision-log
  escalate_to_plan: true
gates:
  - command_contracts
  - rendered_help
  - parser_acceptance
  - runtime_semantics
  - cross_cli_continuations
  - shared_mcporter_transport
  - native_mcp_parity_checklist
result_contracts:
  - browser-use.browser-targets
  - browser-use.browser-operation
```

Decision:

- Define `browser-use.browser-targets` and `browser-use.browser-operation` result contracts in `skills/browser-use/scripts/command-contract.ts`.
- Version both result contracts.
- Build new `browser-use` CLI surfaces through `@side-quest/cli-command-facade` and the `create-cli` contract path.
- Cross-link `browser-adapter-router` and `browser-use` through help and continuations.
- Share `mcporter` command-vector handling with Browser Adapter Proof or prove env/path/argument parity with tests.
- Add native Chrome DevTools MCP parity checks to the plan.

Rationale:

- Agents discover through CLI help and continuation envelopes.
- Two CLIs need mechanical on-ramps or the workflow becomes decision-log archaeology.
- "Native-feel" needs testable parity, not vibes.

Consequences:

- Route success can continue to `browser-use targets list`.
- `browser-use --help` shows route-bound and recovery flows.
- Tests prove discovery metadata, rendered help, parser acceptance, and runtime behavior cannot drift.
- `mcporter` runner behavior cannot drift between Adapter Proof and Browser Operation execution.

Next:

- Decision 32 accepted MVP privacy gates.

## Decision 32: MVP Browser Content Privacy Gates

```yaml
id: browser-use-prepare-operation-032
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What privacy gates are required before browser content leaves the adapter?
  option: minimum_mvp_privacy_controls
  confidence: strong
scope: skills/browser-use
owner:
  - browser-target-discovery
  - browser-operation-front-door
durability:
  current: decision-log
  escalate_to_plan: true
gates:
  - url_path_safety
  - screenshot_artifact_scope
  - snapshot_output_bounds
  - diagnostics_allowlist
  - target_state_permissions
  - v2_high_risk_operation_gate
```

Decision:

- Add MVP privacy gates for target listing, snapshots, screenshots, diagnostics, and target state.
- Treat browser content as sensitive by default.
- Store selected target state only through explicit `--state <path>` or deterministic `BROWSER_USE_TARGET_STATE` / `BROWSER_USE_RUN_ID` paths.
- Write target state with owner-only permissions, atomic writes, short TTL, and no full URLs, adapter handles, CDP ids, or WebSocket debugger URLs.
- Fail stale, unreadable, mismatched, or cross-run target state before operation execution.
- Keep snapshot stdout bounded by default and emit truncation metadata.
- Keep screenshot bytes out of JSON, logs, and diagnostics.
- Write screenshot artifacts under a run-scoped artifact root by default.
- Redact diagnostics through an allowlist that excludes page ids, target ids, session ids, WebSocket debugger URLs, cookies, auth headers, query strings, fragments, and sensitive path segments.
- Gate V2 mutating and inspection operations on a privacy and permission review.

Rationale:

- Warm Chrome is authenticated browser state.
- URLs, paths, titles, snapshots, screenshots, and diagnostics can expose private data.
- Deferring all privacy controls to V2 while shipping screenshots would be unsafe.

Consequences:

- MVP tests cover URL/path redaction, artifact scope, target state permissions, diagnostics allowlist, and snapshot bounds.
- Artifact writes outside the run-scoped root require an explicit unsafe override or fail.
- V2 mutating operations need threat notes, permission posture, redaction rules, and audit behavior before implementation.

Next:

- Escalate accepted decisions to a `ce-plan` implementation plan after log review.

## V2 Ledger

```yaml
id: browser-use-prepare-operation-v2-ledger
status: open
created_at: "2026-06-03"
scope: skills/browser-use
owner:
  - browser-use
  - browser-adapter-router
  - browser-operation-front-door
```

Track for V2:

Accepted follow-ups:

- **Prepare orchestration**:
  - Let `prepare` run Warm Chrome Preflight, Router `report`, and Browser Adapter Proof.
  - Add prepared evidence artifact management.
  - Add `prepare --out <path>`.
  - Add pipe-friendly `prepare` to `route` flow or `route --from-prepare`.
  - Own parent-run correlation for prepared evidence and reusable reports.
- **Operation coverage**:
  - Expand Browser Operations beyond `snapshot`, `screenshot`, and `emulate`.
  - Gate high-risk operations on permission posture, redaction rules, route binding, and audit behavior before implementation.
  - Add navigation, ref action, selector action, text entry, network inspection, console inspection, and performance operations.
  - Add element screenshots by snapshot uid after uid freshness and snapshot provenance rules exist.
  - Add snapshot artifact output support.
- **Transport adapters**:
  - Add native MCP transport selection after MVP CLI contracts and `mcporter` parity are stable.
  - Add Playwright CDP and agent-browser operation adapters after proof exists.
  - Add full native MCP emulation coverage: color scheme, network throttling, CPU throttling, headers, geolocation, and user agent.
- **Target lifecycle**:
  - Add reusable Browser Operation Targets after freshness rules exist.
  - Add run-scoped Browser Operation Target handles for multi-operation flows.
  - Keep adapter target ids out of durable browser knowledge.
  - Store reusable target recipes as Browser Target Hints, not adapter handles.
  - Add target candidate freshness hardening and stale-selection repair hints.
  - Add target candidate diff/status views for tab churn.
  - Add target selection cleanup and state expiry helpers.
  - Add route-bound target reuse only after proof, route, target, and navigation invalidation rules are runtime-checked.
- **Artifacts and privacy**:
  - Add richer screenshot artifact policy, retention, and disclosure controls.
  - Add richer artifacts only after MVP artifact root, permissions, redaction, and cleanup checks exist.
  - Add optional full URL escape hatch only with explicit safety posture and redaction checks.
  - Gate V2 mutating operations on permission posture, auth-bearing state policy, data minimization, redaction rules, origin/route binding checks, and secret-free audit behavior.
- **Report and docs ergonomics**:
  - Add richer `report --plain` or status views if capability output gets dense.
  - Add generated or mechanically checked static docs only if CLI output is insufficient.

Open candidates:

- Consider Browser Operation preparation only after repeated operation-front-door gaps prove the seam.
