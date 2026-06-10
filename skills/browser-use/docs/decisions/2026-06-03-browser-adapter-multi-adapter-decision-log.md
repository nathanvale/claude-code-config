---
title: Browser Adapter Multi-Adapter Decision Log
type: decision-log
status: in-progress
date: "2026-06-03"
timezone: Australia/Melbourne
owner: skills/browser-use
source: /var/folders/_b/0fxx_szx34qchf5vq6j5xd1h0000gn/T/browser-adapter-multi-adapter-grill-handoff.md
decision_metadata_format: fenced-yaml-per-decision
---

# Browser Adapter Multi-Adapter Decision Log

Use this log for decisions made during the multi-adapter grill.

## Decision 1: Adapter Lifecycle Gates

```yaml
id: browser-adapter-multi-adapter-001
status: accepted
decided_at: "2026-06-03"
decision_mode:
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-router
  - browser-adapter-proof
durability:
  current: decision-log
  escalate_to_adr_if: implementation makes the gate model hard to reverse
evidence:
  - router registry knows chrome-devtools, agent-browser, and playwright-cdp
  - browser-adapter-proof accepts only chrome-devtools
  - browser-adapter-map accepts only chrome-devtools
  - router requires verified attachment evidence before selection
```

Decision:

- Use lifecycle gates:
  - `known`: adapter id exists in Router registry.
  - `reportable`: Router can validate capability evidence for the adapter.
  - `provable`: Proof CLI can verify attachment to verified Warm Chrome.
  - `mapped`: Browser Adapter Map exists and validates recovery guidance.
  - `selectable`: Router can choose the adapter for a task.

Rationale:

- Keep adapter identity separate from routability.
- Let `agent-browser` stay known/reportable without pretending proof exists.
- Prevent Router registry membership from implying map or proof support.
- Make driver handoffs explicit.

Consequences:

- Do not add `agent-browser` to Proof or Map adapters until real proof behavior exists.
- Keep Router fail-closed when `adapter_attached_verified_browser` evidence is missing.
- Use gate names in future runbooks and implementation plans.
- Validate map coverage per adapter-emitted diagnostics after a second proof adapter exists.

Next:

- Decision 2 accepted the contract ownership boundary.

## Decision 2: Recovery Contract Ownership

```yaml
id: browser-adapter-multi-adapter-002
status: accepted
decided_at: "2026-06-03"
decision_mode:
  option: 2
  confidence: soft
scope: skills/browser-use
owner:
  - browser-adapter-proof
  - browser-adapter-map
  - browser-adapter-router
durability:
  current: decision-log
  escalate_to_plan_if: production changes start
evidence:
  - proof emits diagnostic codes and continuation action ids
  - map validation derives expected recovery keys from proof and warm-chrome action lists
  - router projects attachment failures into route recovery actions
  - agent-browser has no real proof adapter behavior yet
```

Decision:

- Add a tiny shared recovery contract owner when implementation starts.
- Own diagnostic/action vocabulary and map-key derivation.
- Keep adapter command behavior out of the shared owner.
- Keep `agent-browser` proof facts out until real proof behavior exists.

Rationale:

- Reduce drift between Proof, Map, and Router.
- Avoid making Browser Adapter Map prose the source of truth.
- Avoid a premature full `AdapterProofSpec`.
- Preserve adapter-local commands, config parsing, probe output parsing, and repair commands.

Consequences:

- Shared owner may derive expected Recovery Map keys.
- Shared owner may classify warning-only versus blocking recovery.
- Proof runtime still owns emitted runtime evidence.
- Router still receives attachment evidence as a projection, not repair-command source.
- Maps still own exact operator repair commands and adapter-local prose.

Next:

- Decision 3 accepted the minimum `agent-browser` proof slice.

## Decision 3: Minimum agent-browser Proof Slice

```yaml
id: browser-adapter-multi-adapter-003
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What is the minimum real agent-browser proof slice before adding it to Proof or Map?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-proof
  - browser-adapter-map
durability:
  current: decision-log
  escalate_to_plan_if: agent-browser proof implementation starts
evidence:
  - dependency-only proof does not prove warm-chrome attachment
  - full map plus proof risks inventing recovery before real failures are observed
  - lifecycle gates require provable before mapped or selectable
```

Decision:

- Add `agent-browser` through an attachment vertical slice.
- Prove dependency availability.
- Prove session/CDP binding to verified Warm Chrome.
- Prove one harmless action probe.

Rationale:

- Verify the adapter acts against the same Warm Chrome endpoint.
- Capture real failure modes before writing map recovery prose.
- Keep the first slice independently testable.
- Avoid adding a full adapter abstraction from guessed facts.

Consequences:

- Do not add an `agent-browser` Browser Adapter Map before proof runtime exists.
- Do not mark `agent-browser` selectable from Router until proof evidence exists.
- Use observed proof failures to decide emitted diagnostics and recovery keys.
- Keep exact `agent-browser` command/API facts adapter-local.

Next:

- Decision 4 accepted recovery outcome ownership.

## Decision 4: Recovery Outcome Ownership

```yaml
id: browser-adapter-multi-adapter-004
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Where should recovery outcome semantics live for adapter proof loops?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-proof-cli
  - browser-adapter-proof-runtime
durability:
  current: decision-log
  escalate_to_plan_if: recovery loop implementation starts
evidence:
  - proof cli/runtime can clear stale proof after repair by rerunning proof
  - proof cli/runtime observes adapter diagnostics before router selection
  - driver should follow emitted continuations instead of inventing retry rules
  - router should receive attachment evidence without owning repair-loop semantics
```

Decision:

- Let Proof CLI/runtime own recovery outcome semantics.
- Emit outcome posture for `changed`, `unchanged`, and `human_handoff`.
- Emit retry posture and retry budget guidance.
- Clear stale proof by requiring fresh Proof after repair.

Rationale:

- Keep repair-loop rules close to proof diagnostics.
- Keep the driver simple: call Proof, read continuation, follow the map.
- Keep Router focused on route evidence and selection.
- Avoid putting mechanical retry policy in Browser Adapter Map prose.

Consequences:

- Driver does not infer whether inspection cleared a risk.
- Router does not choose repair commands.
- Maps explain local repair, but Proof CLI/runtime emits the loop posture.
- `inspect_adapter_config` does not auto-clear risk unless fresh Proof emits success.

Next:

- Decision 5 accepted the new-adapter driver runbook shape.

## Decision 5: New Adapter Driver Runbook Shape

```yaml
id: browser-adapter-multi-adapter-005
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What runbook shape should a driver use to create a new Browser Adapter?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-driver-runbook
  - browser-adapter-proof
  - browser-adapter-map
  - browser-adapter-router
durability:
  current: decision-log
  escalate_to_runbook_if: new adapter work starts
evidence:
  - browser-adapter-map should stay focused on adapter-local recovery prose
  - proof cli/runtime owns proof behavior and outcome posture
  - router owns route evidence and selection
  - driver needs a repeatable path across evidence capture, proof, map, tests, and handoff
```

Decision:

- Create a separate new-adapter driver runbook when new adapter work starts.
- Keep adapter creation workflow out of Browser Adapter Map prose.
- Include evidence capture, proof command, map authoring, smoke tests, and handoff failure messages.

Rationale:

- Give drivers one owner for the adapter creation path.
- Keep maps focused on recovery after Proof emits diagnostics.
- Keep CLI help focused on command use, not workflow policy.
- Make lifecycle gate progression inspectable.

Consequences:

- Driver runbook owns adapter creation sequencing.
- Browser Adapter Map owns adapter-local recovery guidance.
- Proof CLI/runtime owns proof outputs and recovery outcome posture.
- Router owns route selection from supplied evidence.

Next:

- Decision 6 accepted warning-only proof evidence projection.

## Decision 6: Warning-Only Proof Evidence Projection

```yaml
id: browser-adapter-multi-adapter-006
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: How should warning-only Proof evidence project into Router?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-proof
  - browser-adapter-router
  - browser-adapter-driver-runbook
durability:
  current: decision-log
  escalate_to_plan_if: router proof projection implementation starts
evidence:
  - warning-only proof is different from failed attachment proof
  - adapter_signal_weak can mean zero pages listed while attachment still works
  - dropping warnings hides useful driver context
  - treating every warning as failure blocks valid weak-signal cases
```

Decision:

- Let Router accept successful Proof evidence with warnings.
- Preserve a warning summary in Router evidence or route output.
- Keep attachment usable when Proof status is `ok`.
- Treat failed Proof as attachment unverified.

Rationale:

- Keep red, yellow, and green states distinct.
- Let the driver see caution without turning caution into failure.
- Preserve weak-signal context for next safe action.
- Avoid blocking valid tasks when a tab can be opened or selected later.

Consequences:

- Failed Proof remains fail-closed.
- Successful Proof with warnings remains selectable evidence.
- Driver surfaces warning context before action.
- Router does not need repair commands for warning-only cases.

Next:

- Decision 7 accepted adapter-local proof handlers behind a tiny registry.

## Decision 7: Proof Handler Shape

```yaml
id: browser-adapter-multi-adapter-007
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What prevents Proof implementation from becoming one huge adapter switch?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-proof-cli
  - browser-adapter-proof-runtime
durability:
  current: decision-log
  escalate_to_plan_if: second proof adapter implementation starts
pattern:
  primary: strategy
  supporting:
    - registry
evidence:
  - current proof runtime switches only on chrome-devtools
  - each adapter has different dependency checks, binding checks, action probes, and output parsing
  - a full plugin system is premature for repo-owned adapter modules
  - one large switch would mix adapter-local behavior in one file
```

Decision:

- Use adapter-local proof handlers behind a tiny registry.
- Treat each handler as a Strategy for proving one adapter.
- Keep the registry as a lookup table, not a plugin system.
- Keep adapter-local dependency checks, binding checks, action probes, and output parsing inside handlers.

Rationale:

- Keep the Proof CLI/runtime entry path shared.
- Keep adapter behavior local and testable.
- Avoid switch growth as more adapters become provable.
- Avoid dynamic plugin machinery before a real extension boundary exists.

Consequences:

- `executeAdapterProof` resolves a handler by adapter id.
- Handler modules own adapter-specific proof mechanics.
- Shared recovery vocabulary may be imported by handlers.
- New adapter work adds a handler only after the proof slice is real.

Next:

- Decision 8 accepted switch-vs-registry guidance placement.

## Decision 8: Switch vs Registry Guidance Placement

```yaml
id: browser-adapter-multi-adapter-008
status: superseded
decided_at: "2026-06-03"
superseded_at: "2026-06-03"
superseded_by: browser-adapter-multi-adapter-009
decision_mode:
  question: Should AGENTS.md include rules for when to use switch versus registry?
  option: 2
  confidence: strong
scope: repo-startup-and-code-style
owner:
  - AGENTS.md
  - context/code-style.md
durability:
  current: decision-log
  implemented_in:
    - AGENTS.md
    - context/code-style.md
evidence:
  - switch-vs-registry is an architecture fork
  - AGENTS.md should carry hard rules and routes, not full pattern essays
  - context/code-style.md already owns code patterns
  - future agents need the trigger before making implementation-shape choices
```

Decision:

- Add a tiny `AGENTS.md` trigger for switch-vs-registry forks.
- Put detailed criteria in `context/code-style.md`.
- Keep the rule scoped to implementation-shape decisions.

Rationale:

- Keep startup instructions lean.
- Route agents to the code-pattern owner.
- Make switch, registry/Strategy, and plugin boundaries explicit.
- Preserve room for local code evidence to override generic preference.

Consequences:

- Agents name variant count, growth pressure, behavior locality, and extension boundary before choosing.
- `switch` stays valid for tiny, closed, stable variants.
- Registry plus Strategy handlers fits growing local variants with different behavior.
- Plugin systems wait for a real external extension boundary.

Next:

- Decision 9 accepted a general code-style route in AGENTS.md.

## Decision 9: General Code Style Route In AGENTS.md

```yaml
id: browser-adapter-multi-adapter-009
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: How much code-structure guidance belongs in AGENTS.md?
  option: general-code-style-route
  confidence: strong
scope: repo-startup-and-code-style
owner:
  - AGENTS.md
  - context/code-style.md
durability:
  current: decision-log
  implemented_in:
    - AGENTS.md
    - context/code-style.md
supersedes:
  - browser-adapter-multi-adapter-008
evidence:
  - AGENTS.md needs to stay small
  - startup instructions should route to owners instead of carrying specific pattern rules
  - context/code-style.md owns code style and implementation patterns
  - code-structure choices is clearer startup language than implementation-shape forks
```

Decision:

- Keep `AGENTS.md` general.
- Route code-structure choices to `context/code-style.md`.
- Keep switch-vs-registry detail in `context/code-style.md`.

Rationale:

- Reduce startup load.
- Preserve a durable owner for implementation-pattern detail.
- Keep the startup rule reusable beyond switch-vs-registry.
- Use clearer wording than implementation-shape fork.

Consequences:

- `AGENTS.md` names the route, not the detailed rule.
- `context/code-style.md` remains the owner for switch, registry/Strategy, and plugin criteria.
- Future pattern rules can land in the code-style owner without bloating startup.

Next:

- Decision 10 accepted diagnostic-code ownership.

## Decision 10: Diagnostic Code Ownership

```yaml
id: browser-adapter-multi-adapter-010
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Where should a new Browser Adapter diagnostic code start?
  option: 3
  confidence: strong
scope: skills/browser-use
owner:
  - shared-recovery-contract
  - browser-adapter-proof
  - browser-adapter-map
  - browser-adapter-router
durability:
  current: decision-log
  escalate_to_plan_if: shared recovery contract implementation starts
evidence:
  - proof-invented codes can drift from map and router handling
  - map-invented codes make prose the source of truth
  - shared recovery vocabulary is already accepted as real
  - browser-adapter-map should validate declared recovery keys instead of inferring from prose
```

Decision:

- Start new Browser Adapter diagnostic codes in the shared recovery contract.
- Let Proof handlers emit only declared diagnostic codes.
- Let Browser Adapter Map validation derive expected keys from declared diagnostics and actions.
- Let Router project only the diagnostic facts it needs for routing and warning summaries.

Rationale:

- Keep one code name, one canonical action, one severity, and one expected map key.
- Prevent Browser Adapter Map prose from becoming the source of truth.
- Make diagnostic-code migration mechanically checkable.
- Preserve adapter-local proof behavior while sharing recovery vocabulary.

Consequences:

- Adding a diagnostic code requires shared contract update first.
- Proof tests cover emitted code and continuation action.
- Map tests cover expected recovery key coverage.
- Router tests cover projection only when the code affects routing evidence or warning output.

Next:

- Decision 11 accepted hybrid map validation coverage.

## Decision 11: Map Validation Coverage

```yaml
id: browser-adapter-multi-adapter-011
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Should Browser Adapter Map validation check global diagnostic codes or only codes the adapter can emit?
  option: 3
  confidence: soft
scope: skills/browser-use
owner:
  - shared-recovery-contract
  - browser-adapter-map
  - browser-adapter-proof
durability:
  current: decision-log
  escalate_to_plan_if: shared recovery contract or second adapter map implementation starts
coverage_model:
  shared_local_keys: all_maps
  diagnostic_codes: adapter_emitted_only
evidence:
  - global diagnostic coverage is simple but bloats each adapter map
  - adapter-emitted coverage is leaner and truer to each adapter
  - shared cli-level recovery keys still need coverage across maps
  - second adapter metadata is needed before adapter-emitted validation can replace current global validation
```

Decision:

- Validate shared local recovery keys across all Browser Adapter Maps.
- Validate diagnostic-code recovery keys only for codes the adapter can emit.
- Keep current global validation acceptable while there is only one map.
- Move to hybrid validation when adapter-emitted diagnostic metadata exists.

Rationale:

- Keep maps lean.
- Keep shared CLI failure recovery covered.
- Avoid forcing adapters to document impossible diagnostics.
- Preserve a migration path from the current one-adapter checker.

Consequences:

- Shared recovery contract needs to distinguish shared local keys from diagnostic codes.
- Adapter proof metadata needs an emitted diagnostic-code list once a second adapter lands.
- Map validation should reject unknown invented keys.
- Map validation should require canonical targets for declared keys.

Next:

- Decision 12 accepted the minimum multi-adapter test matrix.

## Decision 12: Minimum Multi-Adapter Test Matrix

```yaml
id: browser-adapter-multi-adapter-012
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What is the minimum test matrix for multi-adapter proof and routing?
  option: 3
  confidence: strong
scope: skills/browser-use
owner:
  - command-contract
  - browser-adapter-proof
  - browser-adapter-map
  - browser-adapter-router
  - browser-adapter-driver-runbook
durability:
  current: decision-log
  escalate_to_plan_if: multi-adapter implementation starts
test_matrix:
  - contract_discovery
  - rendered_help
  - parser_acceptance
  - proof_handler_runtime
  - map_drift
  - router_selection
  - recovery_loop_smoke
evidence:
  - proof tests alone miss map and router drift
  - router tests alone miss proof handler behavior
  - replay simulator learning says recovery-loop smoke cases matter
  - full replay engine is delayed until runtime retry semantics need it
```

Decision:

- Require contract discovery tests.
- Require rendered help tests.
- Require parser acceptance tests.
- Require Proof handler runtime tests.
- Require Browser Adapter Map drift tests.
- Require Router selection tests.
- Require recovery-loop smoke tests.

Rationale:

- Prove command surfaces cannot drift from contracts.
- Prove adapter-local proof behavior.
- Prove maps cover declared recovery keys.
- Prove Router selection works from fresh proof evidence.
- Prove repair loops stop, warn, or require human handoff without a full replay engine.

Consequences:

- New adapter work carries a cross-surface test burden.
- Recovery-loop smoke stays lightweight until runtime replay earns production depth.
- Test failures should point to the owning surface: contract, proof, map, router, or driver runbook.

Next:

- Decision 13 accepted the minimum operator prose shape.

## Decision 13: Operator Prose Minimum

```yaml
id: browser-adapter-multi-adapter-013
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: How terse can operator prose be before it stops helping recovery?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-map
  - browser-adapter-proof
  - browser-adapter-driver-runbook
durability:
  current: decision-log
  escalate_to_runbook_if: map authoring guidance is created
operator_prose_minimum:
  - diagnostic_code
  - continuation_action
  - map_section
  - rerun_instruction
evidence:
  - code-only prose does not tell the operator what to do next
  - full explanations repeat runtime facts and bloat maps
  - diagnostic code plus continuation action is the strongest anti-drift anchor
  - map guidance should remain terse but actionable
```

Decision:

- Use code plus action plus map section plus rerun instruction as the minimum operator prose shape.
- Keep detailed runtime facts in Proof output and contracts.
- Keep exact local commands in adapter-local map sections.

Rationale:

- Give operators the problem, next action, where to look, and next check.
- Avoid prose-only recovery drift.
- Keep maps readable without becoming runtime specs.

Consequences:

- Recovery Map entries should name the canonical target action.
- Adapter sections should hold exact local commands.
- Map prose should say when to rerun Proof.
- Code-only entries are too terse unless the action and section are obvious from the same line.

Next:

- Decision 14 accepted `RecoveryCatalogue` as the only prototype-born Module candidate to promote.

## Decision 14: Prototype-Born Module Survival

```yaml
id: browser-adapter-multi-adapter-014
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Which prototype-born Module candidates should survive into production?
  option: 2
  confidence: soft
scope: skills/browser-use
owner:
  - shared-recovery-contract
  - browser-adapter-proof
  - browser-adapter-map
  - browser-adapter-router
durability:
  current: decision-log
  escalate_to_plan_if: shared recovery contract implementation starts
survives:
  - RecoveryCatalogue
delayed:
  - AdapterProofSpec
  - ProjectionEngine
  - ExplanationRenderer
  - MapAuthoringHelper
  - ReplayOutcomeEngine
architecture_lens:
  module: RecoveryCatalogue
  interface: diagnostic to action to section to severity lookup
  seam: shared recovery vocabulary seam
  depth: candidate deep Module
  deletion_test: deleting it would spread diagnostic/action/section/severity mapping across Proof, Map, and Router
evidence:
  - shared recovery vocabulary is real today
  - diagnostic/action/section/severity mapping has leverage across Proof, Map, and Router
  - AdapterProofSpec needs real agent-browser proof facts before it earns depth
  - MapAuthoringHelper stays draft-only until a real second map exists
  - ReplayOutcomeEngine stays test-harness learning unless runtime retry semantics need it
```

Decision:

- Promote only `RecoveryCatalogue` as a production Module candidate when implementation starts.
- Keep its Interface narrow: diagnostic to action to section to severity lookup.
- Delay the other prototype-born candidates until a second adapter or runtime need proves the Seam.

Rationale:

- `RecoveryCatalogue` has Depth because one small Interface gives Proof, Map, and Router shared recovery vocabulary.
- It improves Locality by concentrating code/action/section/severity mapping in one place.
- It gives callers Leverage without sharing adapter command behavior.
- The deletion test passes: deleting it would spread the mapping back across multiple callers.

Consequences:

- `RecoveryCatalogue` should not include adapter command vectors, probe parsing, or repair commands.
- `AdapterProofSpec` waits for real `agent-browser` proof facts.
- `MapAuthoringHelper` waits for a real second map.
- `ReplayOutcomeEngine` waits until recovery-loop semantics need runtime ownership.

Next:

- Decide the Interface shape for `RecoveryCatalogue`.

## Architecture Retrospective

```yaml
id: browser-adapter-multi-adapter-architecture-retrospective-001
status: accepted
created_at: "2026-06-03"
scope: decisions-001-through-014
architecture_lens:
  vocabulary:
    - Module
    - Interface
    - Seam
    - Depth
    - Locality
    - Leverage
    - deletion_test
purpose: Retag settled decisions with architecture language without reopening them.
```

Decision 1:

- Module: Browser Adapter lifecycle model.
- Interface: gate names and graduation evidence.
- Seam: Router identity, Proof support, Map support, and route selection.
- Leverage: prevents registry identity from implying routability.
- Locality: concentrates lifecycle language for drivers and plans.

Decision 2:

- Module: shared recovery contract owner.
- Interface: diagnostic/action vocabulary and map-key derivation.
- Seam: shared recovery vocabulary across Proof, Map, and Router.
- Depth: useful only if callers stop re-deriving recovery facts.
- Deletion test: deleting it would move vocabulary drift back into Proof, Map, and Router.

Decision 3:

- Module: `agent-browser` proof slice.
- Interface: dependency check, binding proof, harmless action probe.
- Seam: first real `agent-browser` attachment proof.
- Locality: keeps guessed adapter behavior out until observed.
- Leverage: gives later Map and Router work real evidence.

Decision 4:

- Module: Proof CLI/runtime recovery outcome posture.
- Interface: `changed`, `unchanged`, `human_handoff`, retry posture, stale-proof clearing.
- Seam: driver reads Proof continuation instead of inventing loop rules.
- Locality: retry and proof freshness rules stay beside proof diagnostics.

Decision 5:

- Module: new-adapter driver runbook.
- Interface: evidence capture, proof command, map authoring, smoke tests, handoff failures.
- Seam: driver workflow separate from adapter-local recovery map.
- Leverage: one runbook guides every new adapter slice.

Decision 6:

- Module: warning projection from Proof to Router.
- Interface: successful attachment evidence plus warning summary.
- Seam: Router receives selectable evidence without repair commands.
- Locality: Proof owns warning detection; Router owns route visibility.

Decision 7:

- Module: Proof handler registry.
- Interface: adapter id to Strategy handler.
- Seam: adapter-local proof handler.
- Depth: shared entry path with adapter-local behavior hidden behind handlers.
- Locality: dependency checks, binding checks, probes, and parsing stay with each Adapter.
- Deletion test: deleting the registry would grow a proof switch and mix adapter behavior.

Decision 8:

- Module: superseded startup guidance.
- Interface: switch-vs-registry route.
- Seam: startup instruction to code-style owner.
- Outcome: superseded by Decision 9 for smaller startup Interface.

Decision 9:

- Module: startup code-style route.
- Interface: `For code-structure choices, use context/code-style.md`.
- Seam: startup routes to code-pattern owner.
- Depth: tiny Interface with broad code-style leverage.
- Locality: detailed pattern guidance stays in `context/code-style.md`.

Decision 10:

- Module: diagnostic code ownership.
- Interface: declared diagnostic code before emission.
- Seam: shared recovery contract before Proof, Map, and Router.
- Depth: one code name drives action, severity, map key, tests.
- Locality: diagnostic migration starts from one owner.

Decision 11:

- Module: Map validation coverage model.
- Interface: shared local keys for all maps; adapter-emitted diagnostics for each Adapter.
- Seam: map checker between recovery contract and adapter maps.
- Leverage: prevents noisy maps while preserving shared recovery coverage.
- Deletion test: deleting it reintroduces global-code bloat or adapter-specific gaps.

Decision 12:

- Module: multi-adapter test matrix.
- Interface: contract discovery, help, parser, proof, map, router, recovery-loop smoke.
- Seam: cross-surface verification for adapter changes.
- Leverage: catches drift across command contract, Proof, Map, Router, and driver loop.
- Locality: failures point at the owning surface.

Decision 13:

- Module: operator prose minimum.
- Interface: diagnostic code, continuation action, map section, rerun instruction.
- Seam: map prose between runtime output and operator recovery.
- Depth: terse map lines still carry next-safe-action leverage.

Decision 14:

- Module: `RecoveryCatalogue`.
- Interface: diagnostic to action to section to severity lookup.
- Seam: shared recovery vocabulary seam.
- Depth: candidate deep Module.
- Leverage: Proof, Map, and Router share one recovery vocabulary.
- Locality: code/action/section/severity mapping stays in one place.
- Deletion test: deleting it spreads recovery mapping across Proof, Map, and Router.

## Decision 15: RecoveryCatalogue Interface

```yaml
id: browser-adapter-multi-adapter-015
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What should the RecoveryCatalogue Interface expose?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - shared-recovery-contract
  - browser-adapter-proof
  - browser-adapter-map
  - browser-adapter-router
durability:
  current: decision-log
  escalate_to_plan_if: RecoveryCatalogue implementation starts
architecture_lens:
  module: RecoveryCatalogue
  interface:
    - recovery fact lookup by diagnostic or action id
    - expected map key derivation for shared local keys and adapter-emitted diagnostics
  seam: shared recovery vocabulary seam
  depth: deep Module candidate
  deletion_test: raw constant lists would make callers recreate behavior
evidence:
  - raw constant lists are shallow because callers assemble meaning
  - full adapter spec is premature before agent-browser proof facts exist
  - lookup and expected-map-key helpers give callers leverage through a small interface
```

Decision:

- Expose recovery fact lookup helpers.
- Expose expected-map-key helpers.
- Do not expose only raw constant lists as the primary Interface.
- Do not expose a full adapter spec object yet.

Rationale:

- Give callers a small Interface with real behavior behind it.
- Keep diagnostic/action/section/severity meaning local to one Module.
- Avoid premature `AdapterProofSpec`.
- Keep adapter command behavior outside the catalogue.

Consequences:

- Proof may use lookup helpers to validate emitted codes and actions.
- Map validation may use expected-map-key helpers.
- Router may use lookup helpers only for projection facts it needs.
- Tests should target the `RecoveryCatalogue` Interface, not internal constants.

Next:

- Decide the exact `agent-browser` observation needed to prove Warm Chrome attachment.

## Decision 16: agent-browser Attachment Observation

```yaml
id: browser-adapter-multi-adapter-016
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What exact agent-browser observation proves attachment to the same Warm Chrome endpoint?
  option: 3
  confidence: strong
scope: skills/browser-use
owner:
  - browser-adapter-proof
  - agent-browser-proof-handler
  - browser-adapter-router
durability:
  current: decision-log
  escalate_to_plan_if: agent-browser proof implementation starts
architecture_lens:
  module: agent-browser proof handler
  interface:
    - verified warm chrome endpoint input
    - adapter-observed endpoint or port
    - harmless action probe result
  seam: adapter-local proof handler seam
  depth: candidate Adapter behind Proof handler registry
  locality: agent-browser command and output parsing stay inside the handler
evidence:
  - dependency existence does not prove attachment
  - action probe alone is weak unless tied to the verified endpoint
  - same endpoint or port observation connects agent-browser to verified Warm Chrome
```

Decision:

- Require `agent-browser` to report or derive the same CDP endpoint or port as verified Warm Chrome.
- Require one harmless action probe after endpoint match.
- Treat dependency existence alone as insufficient.
- Treat action success alone as insufficient unless tied to verified Warm Chrome.

Rationale:

- Prove `agent-browser` is talking to this Warm Chrome, not another browser.
- Keep attachment proof stronger than command availability.
- Keep exact command/API details adapter-local.

Consequences:

- `agent-browser` cannot become `provable` until this observation is real.
- Router cannot treat `agent-browser` as attached without this proof evidence.
- Browser Adapter Map for `agent-browser` waits until proof failures are observed.

Next:

- Decide what command or API returns the `agent-browser` endpoint observation.

## Decision 17: agent-browser Proof Commands

```yaml
id: browser-adapter-multi-adapter-017
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What command/API should the agent-browser proof handler use for attachment proof?
  option: 1
  confidence: strong
scope: skills/browser-use
owner:
  - agent-browser-proof-handler
  - browser-adapter-proof
durability:
  current: decision-log
  escalate_to_plan_if: agent-browser proof implementation starts
architecture_lens:
  module: agent-browser proof handler
  interface:
    - verified warm chrome port
    - warm chrome webSocketDebuggerUrl
    - agent-browser cdpUrl output
    - harmless tab-list probe
  seam: adapter-local proof handler seam
  locality: cdp command shape and output parsing stay inside agent-browser handler
commands:
  binding_probe: agent-browser --cdp "$PORT" --json get cdp-url
  action_probe: agent-browser --cdp "$PORT" --json tab list
rejected:
  connect_first: creates session state before proof needs it
  auto_connect: not exact enough for verified Warm Chrome
evidence:
  - local cli help says --cdp connects via Chrome DevTools Protocol
  - local cli help says get cdp-url returns Chrome DevTools Protocol WebSocket URL
  - local run against Warm Chrome returned data.cdpUrl matching webSocketDebuggerUrl
  - local tab list probe returned success true and data.tabs
  - official docs page https://agent-browser.dev/cdp-mode documents CDP mode and --cdp examples
```

Decision:

- Use direct per-command `--cdp <verified port>` for `agent-browser` proof.
- Use `agent-browser --cdp "$PORT" --json get cdp-url` as the binding probe.
- Compare `data.cdpUrl` to Warm Chrome `webSocketDebuggerUrl`.
- Use `agent-browser --cdp "$PORT" --json tab list` as the harmless action probe.
- Do not use `agent-browser connect <port>` as the default proof path.
- Do not use `--auto-connect` for attachment proof.

Rationale:

- Direct `--cdp` ties the command to the verified Warm Chrome port.
- `get cdp-url` returns the browser WebSocket URL needed for exact comparison.
- `tab list` proves a harmless read action after binding proof.
- Avoiding `connect` keeps proof read-oriented and avoids session setup as a prerequisite.
- Avoiding `--auto-connect` prevents attachment to the wrong browser.

Consequences:

- The `agent-browser` proof handler should parse `data.cdpUrl`.
- The handler should fail closed when `data.cdpUrl` differs from Warm Chrome.
- The handler should treat `tab list` success as the harmless action probe.
- Empty `data.tabs` can become warning-only success if binding proof passes.

Next:

- Decide what failure modes `agent-browser` can emit without guessing.

## Decision 18: agent-browser Emitted Failure Modes

```yaml
id: browser-adapter-multi-adapter-018
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What failure modes can agent-browser emit without guessing?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - agent-browser-proof-handler
  - browser-adapter-proof
  - shared-recovery-contract
durability:
  current: decision-log
  escalate_to_plan_if: agent-browser proof implementation starts
architecture_lens:
  module: agent-browser proof handler
  interface:
    - command result
    - json envelope
    - cdpUrl binding proof
    - tab-list probe result
  seam: adapter-local proof handler seam
  locality: emitted failures stay limited to observed handler facts
emit_without_guessing:
  - command_missing
  - command_exit_nonzero
  - output_unparsable
  - success_false
  - cdp_url_missing
  - cdp_url_mismatch
  - tab_list_failed
  - tab_list_empty_warning
do_not_emit_yet:
  - session_stale
  - auto_launch_risk
  - chrome_for_testing_risk
  - config_stale
evidence:
  - local agent-browser binding probe returns success true and data.cdpUrl
  - local tab-list probe returns success true and data.tabs
  - directly observed command and output facts are enough for first proof slice
  - prototype risk states remain guessed until real output exposes them
```

Decision:

- Emit only directly observed `agent-browser` command, output, binding, and probe failures.
- Treat empty tab list as warning-only when binding proof passes.
- Do not emit guessed session, auto-launch, Chrome for Testing, or config-stale risk states yet.

Rationale:

- Keep the Adapter proof handler Interface honest.
- Avoid invented recovery vocabulary.
- Let real `agent-browser` output shape determine future diagnostics.
- Preserve Locality: adapter-specific parsing and failure classification stay inside the handler.

Consequences:

- Shared recovery contract may need generic command/output/binding/probe codes before `agent-browser` lands.
- `agent-browser` Browser Adapter Map should not cover guessed risk diagnostics.
- Future diagnostics require observed output plus shared recovery contract migration.

Next:

- Decision 19 accepted shared generic codes plus adapter-local detail.

## Decision 19: Shared Recovery Codes

```yaml
id: browser-adapter-multi-adapter-019
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: Which recovery codes are shared across chrome-devtools and agent-browser?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - shared-recovery-contract
  - browser-adapter-proof
  - browser-adapter-map
  - chrome-devtools-proof-handler
  - agent-browser-proof-handler
durability:
  current: decision-log
  escalate_to_plan_if: shared recovery contract or agent-browser proof implementation starts
architecture_lens:
  module: shared recovery code vocabulary
  interface:
    - shared diagnostic code
    - adapter-local diagnostic detail
    - canonical continuation action
    - expected map key
  seam: shared recovery vocabulary seam across proof handlers and maps
  locality: generic recovery names stay shared; adapter-specific facts stay inside handlers
shared_codes:
  - adapter_dependency_missing
  - adapter_command_failed
  - adapter_output_unparsable
  - adapter_binding_mismatch
  - adapter_proof_timeout
  - adapter_signal_weak
chrome_devtools_local_codes:
  - adapter_command_override_invalid
  - adapter_config_missing
  - adapter_config_stale
  - adapter_config_parse_error
  - adapter_binding_ambiguous
  - adapter_chrome_for_testing_risk
  - adapter_auto_launch_risk
agent_browser_local_details:
  - cdp_url_missing
  - cdp_url_mismatch
  - tab_list_failed
  - tab_list_empty_warning
evidence:
  - chrome-devtools already emits generic command, output, binding, timeout, and weak-signal diagnostics
  - agent-browser first proof slice observes command, JSON envelope, cdpUrl binding, and tab-list probe facts
  - config-shaped diagnostics do not apply to direct agent-browser CDP proof
  - decision 11 requires shared local keys across maps plus adapter-emitted diagnostic coverage
```

Decision:

- Split shared generic recovery codes from adapter-local diagnostic detail.
- Share command, output, binding, timeout, dependency, and weak-signal codes across adapters.
- Keep `chrome-devtools` config, mcporter, native MCP, auto-launch, and Chrome for Testing diagnostics local.
- Keep `agent-browser` `cdpUrl` and tab-list facts as adapter-local detail unless a future observed failure earns a local code.

Rationale:

- Preserve Locality: shared codes name recovery concepts, not adapter mechanics.
- Avoid forcing `agent-browser` into config-shaped `chrome-devtools` vocabulary.
- Avoid inventing a full `agent_browser_*` family before production proof exists.
- Let the RecoveryCatalogue own code, action, section, severity, and map-key lookup later.

Consequences:

- `agent-browser` proof can map direct observations onto shared codes.
- `cdp_url_mismatch` can emit `adapter_binding_mismatch` with adapter-local detail.
- `cdp_url_missing` can emit `adapter_output_unparsable` with adapter-local detail.
- `tab_list_failed` can emit `adapter_command_failed` with adapter-local detail.
- `tab_list_empty_warning` can emit `adapter_signal_weak` with adapter-local detail.
- Map validation should use shared keys for all maps and adapter-emitted codes per adapter.

Next:

- Decision 20 accepted adapter-emitted diagnostic metadata beside proof handlers.

## Decision 20: Adapter-Emitted Diagnostic Metadata

```yaml
id: browser-adapter-multi-adapter-020
status: accepted
decided_at: "2026-06-03"
decision_mode:
  question: What metadata should proof handlers expose so Map validation can check adapter-emitted diagnostics?
  option: 2
  confidence: strong
scope: skills/browser-use
owner:
  - shared-recovery-contract
  - browser-adapter-proof
  - browser-adapter-map
  - chrome-devtools-proof-handler
  - agent-browser-proof-handler
durability:
  current: decision-log
  escalate_to_plan_if: shared recovery contract or second adapter map implementation starts
architecture_lens:
  module: adapter proof diagnostic metadata
  interface:
    - adapter id
    - emitted diagnostic codes
    - warning-only diagnostic codes
    - adapter-local diagnostic detail keys
  seam: proof handler metadata consumed by map validation
  locality: proof handlers declare runtime-emitted facts; maps document recovery
metadata_shape:
  adapter_id: required
  emitted_diagnostic_codes: required
  warning_only_diagnostic_codes: optional subset
  adapter_local_detail_keys: optional
  excludes:
    - repair commands
    - parser internals
    - raw command output schemas
    - route selection policy
evidence:
  - decision 11 requires adapter-emitted diagnostic coverage once a second adapter lands
  - decision 19 splits shared generic codes from adapter-local details
  - map-owned emitted lists would make maps the runtime source of truth
  - one global diagnostic list forces maps to cover impossible diagnostics
```

Decision:

- Add adapter-emitted diagnostic metadata beside proof handlers when implementation starts.
- Let Map validation consume the proof metadata.
- Keep shared local recovery keys required in every map.
- Keep diagnostic-code map coverage scoped to each adapter's emitted codes.
- Keep repair commands and output parsing out of metadata.

Rationale:

- Preserve runtime ownership of emitted facts.
- Keep Browser Adapter Maps focused on recovery prose.
- Avoid global diagnostic bloat in every map.
- Avoid duplicating emitted-code truth inside markdown.

Consequences:

- `chrome-devtools` metadata can declare current emitted diagnostics.
- `agent-browser` metadata can declare only first-slice emitted shared codes plus local detail keys.
- Map checker can reject unknown recovery keys without forcing impossible diagnostics.
- RecoveryCatalogue can later provide expected-map-key helpers over this metadata.

Next:

- Pause decision work before implementation planning.
