---
title: Test Runner Compact Runner Decision Log
type: decision-log
status: in-progress
date: "2026-06-04"
timezone: Australia/Melbourne
owner: skills/test-runner
source: docs/brainstorms/2026-06-04-test-runner-compact-runner-requirements.md
decision_metadata_format: fenced-yaml-per-decision
---

# Test Runner Compact Runner Decision Log

Use this log for decisions made during the test-runner compact runner grill.

## Decision 1: Durable Runner Benchmark Harness

```yaml
id: test-runner-compact-runner-001
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Should the benchmark harness be a one-time adoption gate, or a durable experimentation surface?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_context: true
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - the user wants follow-up A/B tests over token optimizations
  - issue 172 already requires comparison across native Bun, MCP runner, and skill-local runner
  - a one-time adoption gate would lose the reusable comparison surface
```

Decision:

- Treat the benchmark as a durable Runner Benchmark Harness.
- Keep it reusable for native Bun flags, envelope formats, failure-context budgets, and later token-optimization variants.
- Use the first implementation to prove the skill-local runner without making that first result permanent policy.

Rationale:

- The reusable harness is the product leverage.
- Adoption proof and later optimization experiments can share fixtures and comparison output.
- Durable comparison prevents preference changes based on a single unrepeatable benchmark.

Consequences:

- `CONTEXT.md` owns the term Runner Benchmark Harness.
- The brainstorm and plan must preserve follow-up A/B testing as in-scope harness behavior.
- V1 still limits harness shape to stable fixtures, named variants, and compact comparison output.

Next:

- Decision 2 accepted two-axis variant scoring.

## Decision 2: Two-Axis Variant Score

```yaml
id: test-runner-compact-runner-002
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should the Runner Benchmark Harness optimize for first?
  option: 3
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
scoring:
  axes:
    - token_reduction
    - repair_fidelity
  gate:
    - exit_correctness
evidence:
  - token reduction alone can reward useless failure envelopes
  - repair fidelity alone can preserve verbose output and miss the core value
  - exit correctness is binary and should gate scoring rather than compete with it
```

Decision:

- Score variants on token reduction and repair fidelity together.
- Gate variant acceptance on exit correctness before scoring matters.
- Reject tiny failure envelopes that omit repair-useful context even when token savings are strong.

Rationale:

- The runner exists to reduce agent context without destroying repair ability.
- Wrong exit semantics make a variant invalid, not merely lower-scoring.
- A two-axis score keeps benchmark output honest and reviewable.

Consequences:

- The benchmark output needs variant labels plus token and fidelity results.
- Fixtures need failure cases that can expose missing repair context.
- Adoption decisions use the two-axis score after exit correctness passes.

Next:

- Continue grilling from the top-level product framing.

## Decision 3: Benchmark-Backed Alternative Path

```yaml
id: test-runner-compact-runner-003
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What role should the local runner have in v1?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - skills/test-runner
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - issue 172 says the product question is whether local workflow evidence justifies a test-runner path
  - current runner guidance keeps MCP runners as the incumbent preference
  - the Runner Benchmark Harness exists to prove token, runtime, exit, and failure-fidelity gates before preference changes
```

Decision:

- Treat the local runner as a benchmark-backed alternative path in v1.
- Build and measure the skill-local runner without making it the default path immediately.
- Keep the existing MCP runner preference until benchmark gates justify a guidance change.

Rationale:

- The issue asks for proof, not replacement by assumption.
- The local runner may reduce machinery, but the benchmark must prove usefulness and correctness first.
- A benchmark-backed alternative keeps implementation reversible and avoids premature runner preference drift.

Consequences:

- The skill-local runner is valid implementation work before adoption.
- `context/bun-runner.md` and `rules/code-quality.md` stay unchanged until evidence passes.
- Adoption review belongs after the Runner Benchmark Harness reports token reduction, repair fidelity, runtime, and exit correctness.

Next:

- Continue grilling the benchmark and runner scope from the top of the brainstorm.

## Decision 4: Agents First

```yaml
id: test-runner-compact-runner-004
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Who is the primary user for v1 output?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner
  - runner output contract
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - issue 172 centers token compaction in repeated agent test loops
  - current requirements name agents as the primary user
  - humans and scripts still receive stable help, exit codes, and JSON
```

Decision:

- Optimize v1 output for Codex and Claude Code repair loops.
- Keep compact plain text as the default agent-facing output.
- Support humans and scripts through stable help, exit codes, and JSON output.

Rationale:

- The product value is daily agent-loop token reduction.
- Equal-weight human readability would pull the default output toward verbosity.
- Machine-only JSON would make the core agent loop less direct.

Consequences:

- Default output decisions favor compactness and repair usefulness over human narration.
- Human-facing detail belongs in help, diagnostics, and optional JSON inspection.
- Output tests should assert agent-useful plain summaries and machine-parseable JSON separately.

Next:

- Decide the v1 command scope.

## Decision 5: Bun Test Only In V1

```yaml
id: test-runner-compact-runner-005
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What commands are in scope for v1?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner
  - runner output contract
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - issue 172 focuses on compact Bun test output
  - lint and typecheck have different failure shapes and repair signals
  - current requirements keep lint and typecheck on existing MCP runner guidance
```

Decision:

- Limit v1 command scope to Bun test execution.
- Keep lint and typecheck on existing MCP runner guidance.
- Revisit lint and typecheck only after the test envelope proves value.

Rationale:

- Bun test failures are the specific token problem under evaluation.
- Adding lint and typecheck would mix different parser and repair-context contracts into the first proof.
- A focused v1 gives the Runner Benchmark Harness clearer fixtures and gates.

Consequences:

- Runner fixtures, parser behavior, benchmark variants, and output contracts target Bun test only.
- `SKILL.md` should not present itself as a general quality runner.
- Future lint/typecheck work needs separate evidence or a follow-up decision.

Next:

- Decide the smallest useful local workflow shape.

## Decision 6: Thin Skill Plus Local Script

```yaml
id: test-runner-compact-runner-006
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What is the smallest useful local workflow?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/SKILL.md
  - skills/test-runner/scripts/test-runner.sh
  - skills/test-runner/scripts/test-runner.ts
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - issue 172 asks for a local test-runner skill
  - skill-design guidance keeps deterministic behavior in scripts, help, and tests
  - a script-only proof would skip the requested skill workflow shape
```

Decision:

- Build the smallest useful workflow as a thin `SKILL.md` plus local runner scripts.
- Let `SKILL.md` route agents to the command and name owner paths.
- Let scripts, help, and tests own deterministic behavior.

Rationale:

- The skill is the agent entrypoint.
- The local script is the mechanical contract owner.
- A reference-heavy skill would duplicate script-owned behavior too early.

Consequences:

- `SKILL.md` should stay route-oriented.
- Exact flags, output modes, parser states, timeout behavior, and exit semantics belong outside skill prose.
- The implementation needs both skill prose validation and script behavior tests.

Next:

- Decide the agent output contract.

## Decision 7: Plain Default, JSON Backed

```yaml
id: test-runner-compact-runner-007
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What output should agents consume?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner output contract
  - runner tests
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - agents need compact default output during repeated test loops
  - tests and benchmarks need parseable output for stable assertions
  - JSON-only would add friction to the primary agent loop
```

Decision:

- Use compact plain text as the default agent-facing output.
- Provide JSON output for tests, benchmarks, and future automation.
- Keep plain and JSON behavior aligned through script-owned tests.

Rationale:

- Plain output is fastest for agent repair loops.
- JSON gives deterministic inspection without asking `SKILL.md` to copy schemas.
- Both modes support different users without making the default verbose.

Consequences:

- Runner tests must cover both plain and JSON modes.
- Benchmark checks should use JSON or structured data where possible.
- Skill prose should point to help for exact output modes instead of restating them.

Next:

- Decide the failure context shape.

## Decision 8: Bounded Repair Envelope

```yaml
id: test-runner-compact-runner-008
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should failures preserve enough context without flooding tokens?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner output contract
  - runner parser
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - raw Bun failure logs are the token problem
  - summary-only failures can omit repair-critical assertion context
  - the two-axis score rejects tiny envelopes that lose repair fidelity
```

Decision:

- Emit a bounded repair envelope for failures.
- Include failing file, failing test, assertion signal, and nearby diagnostic text.
- Cap noisy details so large red runs do not flood agent context.

Rationale:

- Repair usefulness depends on concrete failure context.
- Token savings depend on bounded output.
- The envelope should preserve enough signal for a first repair attempt without blind reruns.

Consequences:

- Fixtures need failures that test file, test-name, assertion, and diagnostic extraction.
- The benchmark needs repair-fidelity checks that penalize missing context.
- Exact caps belong in script help, code, and tests.

Next:

- Decide benchmark baselines.

## Decision 9: Native, MCP When Available, Local Runner

```yaml
id: test-runner-compact-runner-009
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Which benchmark baselines should v1 compare?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - issue 172 requires comparison against native shell Bun and existing MCP Bun runner when available
  - published CLI extraction is out of scope for this issue
  - MCP remains the incumbent preference and should stay visible in adoption evidence
```

Decision:

- Compare native Bun, MCP when available, and the skill-local runner.
- Keep published CLI comparison out of v1.
- Treat MCP as the incumbent baseline, not a dependency of the local runner.

Rationale:

- Native Bun shows the raw baseline.
- MCP shows the current preferred compact-envelope path.
- Local runner evidence needs both comparisons before adoption review.

Consequences:

- The harness needs variant labels for native, MCP, and local paths.
- Published CLI comparison can be added later only if extraction pressure appears.
- Adoption review should mention MCP evidence when available.

Next:

- Decide how MCP unavailability behaves in the harness.

## Decision 10: MCP Unavailable Marks Skipped

```yaml
id: test-runner-compact-runner-010
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should the benchmark do when MCP is unavailable?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - MCP tools may not be callable from every local benchmark process
  - failing the whole proof would make local runner validation depend on tool availability
  - mocking MCP would weaken adoption evidence by inventing baseline behavior
```

Decision:

- Mark MCP comparison as skipped when unavailable.
- Continue evaluating native Bun versus the local runner.
- Do not mock MCP output as adoption evidence.

Rationale:

- MCP availability is an environment constraint, not a local proof failure.
- Native versus local evidence remains useful without MCP.
- Skipped is more honest than mocked for reviewer trust.

Consequences:

- Benchmark output needs a skipped state with a short reason.
- Adoption review should distinguish complete comparisons from MCP-skipped runs.
- Local runner acceptance can proceed only on gates it actually measured.

Next:

- Continue grilling output, benchmark gates, locality, and ownership decisions.

## Decision 11: MCP Deprecation After Proof

```yaml
id: test-runner-compact-runner-011
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What is the target runner direction?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - context/bun-runner.md
  - rules/code-quality.md
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
  reflected_in_context: false
evidence:
  - the desired target state is no MCP dependency for Bun test loops
  - MCP remains current enforced guidance until benchmark gates pass
  - the local runner needs proof before replacing startup and rule guidance
```

Decision:

- Treat the local runner as the intended MCP deprecation path if benchmark gates pass.
- Keep current MCP runner guidance unchanged during proof.
- Deprecate MCP guidance only after the local runner proves token reduction, repair fidelity, exit correctness, and runtime viability.

Rationale:

- The target state is simpler runner guidance with no MCP dependency for Bun test loops.
- Premature deprecation would remove the current enforced safe path before the replacement proves itself.
- A benchmark-gated deprecation path keeps the goal clear without weakening the proof gate.

Consequences:

- The brainstorm and plan should name MCP deprecation as the intended direction.
- `context/bun-runner.md` and `rules/code-quality.md` remain unchanged until gates pass.
- U5 becomes an MCP deprecation review, not a neutral preference review.

Next:

- Continue grilling benchmark gates, output budget, diagnostics, and contract ownership.

## Decision 12: Four Benchmark Metrics

```yaml
id: test-runner-compact-runner-012
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What metrics should the Runner Benchmark Harness report?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - token count alone can hide broken repair usefulness
  - exit correctness is required before scoring matters
  - runtime viability matters if the local runner is intended to replace MCP guidance
```

Decision:

- Report token estimate, wall time, exit correctness, and failure fidelity.
- Keep exit correctness as a gate.
- Use token estimate and failure fidelity as paired scoring axes.

Rationale:

- MCP deprecation needs broader proof than token reduction.
- Wall time catches replacement paths that save context but slow daily loops.
- Failure fidelity protects repair usefulness.

Consequences:

- Benchmark fixtures need pass, fail, and wrong-exit sensitivity.
- Benchmark output must stay compact while showing all four signals.
- Adoption review should require measured evidence for all four metrics.

Next:

- Decide pass output shape.

## Decision 13: Tiny Trust Summary

```yaml
id: test-runner-compact-runner-013
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What shape should passing output use?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner output contract
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - silent success can be ambiguous in agent loops
  - dots-style streams do not name enough trust context by themselves
  - issue evidence shows compact pass summaries can be very small
```

Decision:

- Emit a tiny trust summary on pass.
- Include status, test or file count, focused target when available, duration, and exit.
- Keep pass output smaller than raw Bun output.

Rationale:

- Agents need enough evidence to trust the run completed.
- Silence makes completed runs harder to distinguish from missing output.
- A compact summary supports repeated green loops without context noise.

Consequences:

- Runner tests should assert green output contains trust signals.
- Exact wording and field names belong in the runner contract owner.
- Benchmark pass fixtures should compare native, MCP, and local pass output size.

Next:

- Decide contract ownership.

## Decision 14: Scripts Help Tests Own Contract

```yaml
id: test-runner-compact-runner-014
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Where should deterministic runner contracts live?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/scripts/test-runner.ts
  - skills/test-runner/scripts/test-runner.sh
  - runner help
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - skill-design philosophy forbids copying flags, schemas, state machines, and output semantics into SKILL.md
  - create-cli guidance keeps deterministic CLI behavior in help, code, and tests
  - reference docs would add another drift surface for a small v1 runner
```

Decision:

- Put deterministic runner contracts in scripts, help, and tests.
- Keep `SKILL.md` limited to trigger, workflow, owner paths, command pointer, and next safe action.
- Avoid adding a contract reference doc in v1.

Rationale:

- The script is the mechanical owner.
- Help and tests are checkable.
- Extra prose contract surfaces increase drift risk.

Consequences:

- `SKILL.md` should point agents to runner help for exact flags and modes.
- Output schemas, parser behavior, timeout semantics, and exit codes stay out of skill prose.
- Validation should scan `SKILL.md` for copied deterministic contracts.

Next:

- Decide the CLI lane.

## Decision 15: Agent-Native CLI Without Facade Runtime

```yaml
id: test-runner-compact-runner-015
status: superseded
decided_at: "2026-06-04"
superseded_at: "2026-06-04"
superseded_by: test-runner-compact-runner-022
decision_mode:
  question: Which create-cli lane should the runner use?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner CLI surface
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - agents are the primary users
  - output can be token-heavy and needs budget controls
  - facade-backed implementation was not requested and would add v1 machinery
```

Decision:

- Treat the runner as an agent-native CLI surface.
- Apply `create-cli` agent-native guidance before implementation.
- Do not use the facade runtime in v1.

Rationale:

- The runner needs discoverable help, non-interactive execution, parseable output, recoverable failures, and output budget controls.
- Agent-native is a design lane, not a facade requirement.
- Facade-backed runtime validation is extra machinery for this local proof.

Consequences:

- The plan should name owner paths before implementation.
- Runner validation should cover help, parser acceptance, runtime semantics, and budgeted output.
- Facade extraction remains out of scope unless future evidence earns it.

Next:

- Superseded by Decision 22 because structured recovery diagnostics need facade-backed support.

## Decision 16: Script-Owned Output Budget Controls

```yaml
id: test-runner-compact-runner-016
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Where should output budget controls live?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner output contract
  - runner help
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - large red runs are the core token-risk path
  - hidden fixed caps make behavior harder to inspect
  - skill-owned caps would copy deterministic contract details into prose
```

Decision:

- Let the script own failure limits and truncation behavior.
- Expose budget controls through runner help and tests.
- Keep exact cap values out of `SKILL.md`.

Rationale:

- Budget behavior is deterministic CLI contract surface.
- Agents need discoverable controls when a red run is too sparse or too noisy.
- Tests can prove truncation behavior without prose drift.

Consequences:

- Runner tests need large-failure cases that prove caps.
- Help should describe available budget controls without relying on skill prose.
- Benchmark variants can compare different failure-context budgets.

Next:

- Continue grilling diagnostics, timeout, JSON/plain alignment, and deprecation gates.

## Decision 17: Structured Recovery Diagnostics

```yaml
id: test-runner-compact-runner-017
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should runner errors diagnose recovery?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - facade-backed runner contract
  - runner diagnostics
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - agent-native CLI guidance treats structured failure and retry safety as minimum recovery signals
  - MCP deprecation needs actionable local diagnostics, not raw shell errors
  - invalid cwd, missing Bun, timeout, and invocation failures are expected runner failure modes
```

Decision:

- Emit structured recovery diagnostics for invalid cwd, missing Bun, timeout, and invocation errors.
- Name cause, same-input retry safety, and next action.
- Keep diagnostics safe for agent-visible output.

Rationale:

- Agents need repair paths without guessing.
- Local runner failures should be more legible than raw process errors.
- Structured diagnostics help justify facade-backed support.

Consequences:

- Runner tests must cover expected diagnostic categories and retry-safety signals.
- Help should route users to recovery behavior without copying diagnostic schemas into `SKILL.md`.
- Facade-backed implementation should own the structured failure surface.

Next:

- Decide timeout contract.

## Decision 18: Script-Owned Configurable Timeout

```yaml
id: test-runner-compact-runner-018
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should timeout behavior work?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner CLI surface
  - runner help
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - timeout behavior is already required by the brainstorm and plan
  - long-running tests need a bounded agent loop
  - exact timeout values are deterministic contract details
```

Decision:

- Use a script-owned default timeout.
- Provide a flag or environment override through runner help and tests.
- Keep exact timeout semantics out of `SKILL.md`.

Rationale:

- Agents need bounded non-interactive execution.
- Some projects or focused runs may legitimately need a longer timeout.
- Help and tests can keep timeout behavior discoverable and stable.

Consequences:

- Runner tests need timeout success and timeout failure cases.
- Timeout failures should emit structured recovery diagnostics.
- Implementation should decide flag/env precedence through the CLI contract owner.

Next:

- Decide plain and JSON alignment.

## Decision 19: One Result Model Two Renderers

```yaml
id: test-runner-compact-runner-019
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should plain and JSON output stay aligned?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner result model
  - plain renderer
  - JSON renderer
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - plain and JSON modes need the same underlying test facts
  - separate parse paths can drift under edge cases
  - tests and benchmarks need parseable output without scraping plain prose
```

Decision:

- Build one internal result model.
- Render compact plain output and JSON output from that result.
- Test alignment through shared fixtures.

Rationale:

- One model reduces drift between agent-facing and machine-facing output.
- Plain output can stay compact while JSON remains deterministic.
- Shared fixtures make future format changes safer.

Consequences:

- Parser logic should populate result facts before rendering.
- Tests should assert equivalent facts across plain and JSON paths.
- Benchmark checks should use the model or JSON path where possible.

Next:

- Decide fixture location.

## Decision 20: Skill-Local Fixtures

```yaml
id: test-runner-compact-runner-020
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Where should benchmark and parser fixtures live?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/scripts/fixtures
  - runner tests
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - fixtures are specific to the test-runner skill proof
  - shared repo fixtures would imply broader ownership too early
  - generated-only fixtures can make benchmark evidence harder to inspect
```

Decision:

- Keep benchmark and parser fixtures under `skills/test-runner/scripts/fixtures`.
- Use fixtures for representative pass, assertion failure, multi-failure, invalid cwd, pass-through arg, and timeout cases.
- Avoid shared repo fixture ownership in v1.

Rationale:

- Skill-local fixtures keep ownership clear.
- Static fixtures are inspectable by maintainers and agents.
- The harness remains reusable without becoming a repo-wide fixture framework.

Consequences:

- Fixture paths should be named in plan implementation units.
- Benchmark output can cite fixture names.
- Future shared runner work can extract fixtures only after reuse pressure appears.

Next:

- Decide the MCP deprecation gate.

## Decision 21: Evidence Bundle Deprecation Gate

```yaml
id: test-runner-compact-runner-021
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What gate should allow MCP guidance deprecation?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - context/bun-runner.md
  - rules/code-quality.md
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - fixed numeric thresholds can miss repair-quality and diagnostic gaps
  - maintainer judgment alone is too weak for removing current enforced guidance
  - deprecation should be reviewable from benchmark output plus guidance diff
```

Decision:

- Deprecate MCP guidance only after an evidence bundle is reviewed.
- Include benchmark output proving token estimate, wall time, exit correctness, failure fidelity, and structured recovery diagnostics.
- Include the proposed `context/bun-runner.md` and `rules/code-quality.md` guidance diff.

Rationale:

- Deprecation affects startup and enforcement behavior.
- Evidence should be inspectable without rerunning the full investigation.
- A guidance diff makes the user-facing policy change explicit.

Consequences:

- U5 should produce or inspect an evidence bundle before changing guidance.
- Numeric thresholds can inform review but should not be the only gate.
- Benchmark output needs enough detail to support deprecation review.

Next:

- Record the reopened CLI lane decision.

## Decision 22: Facade-Backed Runner CLI

```yaml
id: test-runner-compact-runner-022
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Should the runner remain agent-native without facade runtime, or become facade-backed to support structured recovery diagnostics?
  option: 2
  confidence: strong
scope: skills/test-runner
owner:
  - facade-backed runner contract
  - runner result model
  - runner diagnostics
  - runner tests
supersedes:
  - test-runner-compact-runner-015
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - Decision 17 requires structured recovery diagnostics
  - facade-backed CLI support gives stronger validation for failure categories and retry safety
  - MCP deprecation needs a robust replacement contract
```

Decision:

- Use the facade-backed CLI lane for the local runner.
- Apply agent-native CLI guidance, then use facade runtime support for structured recovery diagnostics.
- Treat Decision 15 as superseded.

Rationale:

- Structured diagnostics are now core to the replacement path.
- The facade-backed lane reduces drift between help, parser acceptance, runtime semantics, and result shape.
- The extra machinery is justified by MCP deprecation risk.

Consequences:

- The plan should read `skills/create-cli/references/cli-command-facade.md` before implementation.
- Owner naming must include contract, model, engine or parser, discovery/help, CLI, and tests where applicable.
- If implementation needs a new dependency, ask before adding it.

Next:

- Continue grilling remaining benchmark and adoption details.

## Decision 23: Ask Before Adding Facade Dependency

```yaml
id: test-runner-compact-runner-023
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What dependency policy should facade-backed implementation follow?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - facade-backed runner contract
  - implementation plan
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - repo instructions require asking before new dependencies
  - facade-backed support may already be available locally
  - structured recovery needs facade-backed design, not silent dependency churn
```

Decision:

- Follow facade-backed design.
- Probe existing facade runtime availability during implementation.
- Ask before adding a new dependency if the runtime is not already available.

Rationale:

- Dependency changes are high-consequence in this repo.
- The design lane can be settled before the dependency mechanism is known.
- Asking preserves maintainer control over package boundaries.

Consequences:

- The plan should keep dependency addition out of automatic implementation.
- Implementation should report whether facade runtime is already available.
- A local facade-like clone is not the default.

Next:

- Decide stable entrypoint.

## Decision 24: Shell Wrapper Plus TypeScript Runner

```yaml
id: test-runner-compact-runner-024
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What stable command entrypoint should agents use?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/scripts/test-runner.sh
  - skills/test-runner/scripts/test-runner.ts
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - issue 172 proposes scripts/test-runner.sh plus scripts/test-runner.ts
  - a shell wrapper gives agents a stable command
  - TypeScript should own the runner logic and tests
```

Decision:

- Use `skills/test-runner/scripts/test-runner.sh` as the stable command.
- Use `skills/test-runner/scripts/test-runner.ts` for runner logic.
- Keep package scripts secondary to the stable wrapper.

Rationale:

- The wrapper gives `SKILL.md` a simple route.
- TypeScript keeps parsing, rendering, and diagnostics testable.
- Package scripts can move without changing the skill command.

Consequences:

- Help and smoke tests should exercise the shell wrapper.
- TypeScript tests should exercise core runner behavior.
- `SKILL.md` should point to the wrapper, not duplicate TypeScript invocation details.

Next:

- Decide benchmark output format.

## Decision 25: Compact Evidence Table Plus JSON

```yaml
id: test-runner-compact-runner-025
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What output format should the benchmark use?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - benchmark renderer
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - maintainers need reviewable deprecation evidence
  - tests and future automation need machine-readable detail
  - markdown-only or JSON-only would underserve one side
```

Decision:

- Emit a compact evidence table for review.
- Emit JSON details for tests, comparisons, and future automation.
- Keep benchmark output compact enough for agent context.

Rationale:

- MCP deprecation needs human-readable evidence.
- The harness is durable and needs machine-readable data for later variants.
- A paired output approach mirrors the runner's plain-plus-JSON shape.

Consequences:

- Benchmark tests should parse JSON details.
- Reviewers should be able to inspect summary rows without raw logs.
- Evidence bundles can include both summary and JSON artifact.

Next:

- Decide guidance update timing.

## Decision 26: Same-Issue Guidance Update If Gates Pass

```yaml
id: test-runner-compact-runner-026
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: When should MCP guidance be updated if gates pass?
  option: 1
  confidence: soft
scope: skills/test-runner
owner:
  - context/bun-runner.md
  - rules/code-quality.md
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - the issue goal is to prove whether local runner guidance can replace MCP guidance
  - the evidence bundle gate prevents premature guidance changes
  - same-issue update reduces handoff delay if the proof is clear
```

Decision:

- Update MCP runner guidance in the same issue if benchmark gates pass and the evidence bundle is reviewed.
- Leave guidance unchanged if gates do not pass.
- Use a follow-up only when the evidence or guidance diff is too large for the issue scope.

Rationale:

- The deprecation path is part of this issue's product shape.
- Keeping the guidance update close to the proof reduces drift.
- The pick is soft because implementation evidence may reveal scope pressure.

Consequences:

- U5 can edit `context/bun-runner.md` and `rules/code-quality.md` after gates pass.
- The implementation should stop before guidance edits if evidence is incomplete.
- Review should call out whether the same-issue update remains appropriately scoped.

Next:

- Decide Bun arg pass-through shape.

## Decision 27: Explicit Separator For Bun Args

```yaml
id: test-runner-compact-runner-027
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should the runner pass arguments through to Bun?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner CLI parser
  - runner help
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - pass-through args are required without copying Bun's flag contract into SKILL.md
  - forwarding unknown args can hide typos in runner-owned flags
  - an explicit separator is familiar CLI behavior
```

Decision:

- Parse runner-owned args before `--`.
- Pass arguments after `--` through to Bun.
- Do not forward unknown runner-side args implicitly.

Rationale:

- The separator keeps runner and Bun contracts distinct.
- Agents can still use Bun focus and reporter flags when needed.
- Unknown runner flags should fail clearly instead of silently changing behavior.

Consequences:

- Help should show the separator pattern.
- Parser tests should cover runner args, Bun args after `--`, and unknown runner-side args.
- `SKILL.md` should not copy Bun flag examples beyond pointing to runner help.

Next:

- Continue grilling fixture breadth, scoring thresholds, and evidence artifacts.

## Decision 28: Representative Fixed Fixture Set

```yaml
id: test-runner-compact-runner-028
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What fixture breadth should v1 use?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/scripts/fixtures
  - runner tests
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - pass and failure paths both need proof
  - parser and diagnostic behavior needs expected edge cases
  - a large corpus would delay v1 before the core proof exists
```

Decision:

- Use a representative fixed fixture set in v1.
- Include pass, assertion failure, multi-failure, invalid cwd, pass-through arg, and timeout cases.
- Defer broad Bun-output corpus work until repeated failures or reuse pressure justify it.

Rationale:

- The fixed set proves the core runner contract without becoming a fixture project.
- Each fixture maps to a known requirement or gate.
- Inspectable fixtures make benchmark evidence easier to review.

Consequences:

- Fixture names should stay stable and readable.
- Benchmark output can cite fixture labels.
- Future variants should reuse the same fixtures before adding more.

Next:

- Decide failure fidelity scoring.

## Decision 29: Failure Fidelity Signal Checklist

```yaml
id: test-runner-compact-runner-029
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should failure fidelity be scored?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - required repair signals are already named in the requirements
  - deterministic scoring is easier to test than LLM judgment
  - manual review alone is too weak for MCP deprecation evidence
```

Decision:

- Score failure fidelity with a deterministic signal checklist.
- Require failing file, failing test name, assertion signal, and bounded diagnostics.
- Penalize envelopes that omit required repair signals.

Rationale:

- The runner should prove repair usefulness mechanically before adoption review.
- A checklist keeps scoring stable across runs.
- Human review can inspect evidence but should not be the only scorer.

Consequences:

- Fixtures need expected signals.
- Benchmark output should show which fidelity signals passed or failed.
- LLM judging can remain out of v1.

Next:

- Decide token estimate method.

## Decision 30: Deterministic Token Approximation

```yaml
id: test-runner-compact-runner-030
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should token estimate be measured?
  option: 1
  confidence: soft
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - relative comparison matters more than exact tokenizer parity in v1
  - adding tokenizer dependency would widen the proof
  - character count alone hides the token-budget framing
```

Decision:

- Use a stable local token or character heuristic for relative comparison.
- Label the metric as an estimate.
- Avoid adding an exact tokenizer dependency in v1 unless implementation evidence proves it necessary.

Rationale:

- The harness needs repeatable relative numbers.
- Exact tokenizer parity is less important than consistent comparison across variants.
- The pick is soft because implementation may find an existing tokenizer already available.

Consequences:

- Benchmark output should name the estimate method.
- Adoption review should treat token numbers as relative evidence.
- A future variant can replace the estimator only if it preserves comparability.

Next:

- Decide raw log handling.

## Decision 31: Transient Raw Logs With Optional Debug Artifact

```yaml
id: test-runner-compact-runner-031
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should raw Bun logs be handled?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner diagnostics
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - raw logs are the context-flooding problem
  - debugging parser mistakes may require raw output access
  - persisting raw logs by default can create noisy artifacts and sensitive-output risk
```

Decision:

- Keep raw Bun output transient by default.
- Expose an optional debug artifact when raw output is needed.
- Do not persist raw logs for normal runner or benchmark paths.

Rationale:

- Compact output is the product value.
- Optional debug artifacts preserve inspectability during parser work.
- Default non-persistence reduces artifact noise and leakage risk.

Consequences:

- Help should describe debug artifact behavior if exposed.
- Tests should prove normal output does not dump raw logs.
- Evidence bundles should include compact results and JSON details, not raw logs by default.

Next:

- Decide result correlation.

## Decision 32: Run Correlation ID

```yaml
id: test-runner-compact-runner-032
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should results correlate with diagnostics?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - runner result model
  - runner diagnostics
  - facade-backed runner contract
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
  reflected_in_context: true
evidence:
  - agent-native CLI guidance includes run correlation
  - structured recovery diagnostics need a stable link to debug artifacts
  - timestamps alone are weaker for matching output to diagnostics
```

Decision:

- Include a run correlation ID in JSON and diagnostics.
- Include it in plain output when it helps connect to diagnostic or debug artifacts.
- Do not rely on timestamps as the correlation mechanism.

Rationale:

- Agents need a stable handle when a run emits diagnostics.
- Correlation supports optional debug artifacts without dumping raw logs.
- The term already exists in `CONTEXT.md`.

Consequences:

- Result model tests should assert correlation ID presence where required.
- Debug artifacts should include or derive from the same run correlation.
- Plain output can omit the ID on tiny green runs unless a diagnostic pointer exists.

Next:

- Continue grilling thresholds, adoption evidence, and validation commands.

## Decision 33: Threshold Ranges Now, Exact Gates After First Run

```yaml
id: test-runner-compact-runner-033
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: When should numeric adoption thresholds be set?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - adoption evidence bundle
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - exact token and runtime thresholds are hard to set before the first local run
  - the plan still needs gate categories so implementation knows what to measure
  - MCP deprecation should not rely on uncalibrated numbers
```

Decision:

- Name adoption gate categories during planning.
- Let the first benchmark run produce candidate token, runtime, and fidelity thresholds.
- Record exact gates with the evidence bundle before deprecating guidance.

Rationale:

- Thresholds need local baseline evidence.
- Gate categories keep implementation directed.
- Candidate thresholds can be reviewed against actual native, MCP, and local runner data.

Consequences:

- The plan should avoid invented exact numbers.
- Benchmark output should make threshold selection easy.
- Adoption review should record the accepted exact gates.

Next:

- Decide validation command breadth.

## Decision 34: Layered Validation

```yaml
id: test-runner-compact-runner-034
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What validation should implementation prove?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skill validation
  - runner tests
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - facade-backed runner work has multiple drift surfaces
  - SKILL.md must stay thin while help and tests own deterministic behavior
  - MCP deprecation needs stronger proof than tests alone
```

Decision:

- Validate frontmatter, help, parser acceptance, runtime fixtures, benchmark output, and skill prose.
- Scan skill prose for copied deterministic contracts.
- Keep manual inspection as support, not the only proof.

Rationale:

- Each layer protects a different drift surface.
- Help, parser, runtime, and benchmark behavior can diverge if only unit tests run.
- Skill-prose scan preserves the owner boundary.

Consequences:

- Implementation units should name validation commands.
- U5 should report validation results with the evidence bundle.
- Test-only validation is insufficient for MCP deprecation.

Next:

- Decide skill invocation mode.

## Decision 35: Path-Scoped On-Demand Skill

```yaml
id: test-runner-compact-runner-035
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What invocation mode should the skill use?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/SKILL.md
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - the runner is not preferred until evidence gates pass
  - path-scoped use avoids replacing global runner behavior prematurely
  - user can still ask for the compact runner explicitly
```

Decision:

- Make the skill path-scoped or on-demand for v1.
- Use it when running Bun tests in this repo or when the user asks for the compact runner.
- Do not make it an always-preferred runner until guidance deprecation lands.

Rationale:

- The skill should support proof without causing preference drift.
- Explicit or scoped invocation keeps the current MCP rule intact during proof.
- Guidance can change after the evidence bundle passes.

Consequences:

- `SKILL.md` should state its trigger narrowly.
- Startup guidance stays unchanged until deprecation.
- After deprecation, invocation guidance can become the preferred test route.

Next:

- Decide deprecation wording.

## Decision 36: Replace MCP Preference With Local Runner Route

```yaml
id: test-runner-compact-runner-036
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should deprecation wording do after gates pass?
  option: 1
  confidence: soft
scope: skills/test-runner
owner:
  - context/bun-runner.md
  - rules/code-quality.md
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - target state is no MCP runner tools for routine quality runners
  - keeping MCP as acceptable fallback can preserve the old preference by habit
  - historical benchmark context can remain without active runner guidance
```

Decision:

- Replace MCP runner preference with the local runner route after gates pass.
- Keep MCP only as historical benchmark context after deprecation.
- Do not soft-deprecate MCP as an equally acceptable fallback.

Rationale:

- The target state is to remove MCP runner dependency.
- Active fallback language can keep agents choosing the old path.
- The pick is soft because the final wording should follow the evidence bundle and actual runner coverage.

Consequences:

- Guidance diffs should remove MCP as the preferred Bun test route.
- MCP comparison can remain in benchmark docs or evidence history.
- If local runner coverage is incomplete, the deprecation diff should name the remaining gap instead of pretending full replacement.

Next:

- Decide future lint and typecheck scope.

## Decision 37: Follow-Up Lint And Typecheck Migration Proofs

```yaml
id: test-runner-compact-runner-037
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should lint and typecheck be handled after the test runner proof?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - future lint runner proof
  - future typecheck runner proof
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - v1 remains Bun test only
  - the user wants the same benchmark-backed evaluation for lint and typecheck
  - the target state is no MCP tools for quality runners
```

Decision:

- Keep lint and typecheck out of v1 implementation.
- Record lint and typecheck as follow-up migration proofs using the same benchmark-backed pattern.
- Aim to retire MCP runner guidance for all routine quality runners if each local path proves value.

Rationale:

- Test runner proof should land first so the harness shape is not overloaded.
- Lint and typecheck have different failure envelopes and fidelity signals.
- The broader runner direction is clear: no MCP tools for routine quality runners after local replacements prove themselves.

Consequences:

- The plan should defer lint and typecheck but name the migration track.
- The Runner Benchmark Harness should remain reusable across future lint/typecheck experiments.
- Future work needs separate fixtures, metrics, and deprecation evidence for each runner family.

Next:

- Continue grilling final acceptance, implementation sequencing, and handoff boundaries.

## Decision 38: Harness First Sequencing

```yaml
id: test-runner-compact-runner-038
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What implementation sequencing should v1 use?
  option: 1
  confidence: soft
scope: skills/test-runner
owner:
  - implementation plan
  - Runner Benchmark Harness
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - benchmark proof gates the MCP deprecation path
  - fixtures make runner behavior testable as it lands
  - implementation evidence may justify small sequencing adjustments
```

Decision:

- Build fixtures and the Runner Benchmark Harness early.
- Implement runner behavior after the harness shape exists.
- Add skill prose and deprecation review after runner proof exists.

Rationale:

- The harness is the evidence surface.
- Early fixtures keep output and scoring honest.
- The pick is soft because implementation may need a thin runner stub before full harness execution.

Consequences:

- Plan sequencing should keep benchmark and fixtures first.
- U5 remains after runner validation.
- Implementation may use a stub variant only if it preserves the evidence-first shape.

Next:

- Decide facade owner naming.

## Decision 39: Name All Facade Owners In Plan

```yaml
id: test-runner-compact-runner-039
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should facade-backed owner naming work?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - implementation plan
  - facade-backed runner contract
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - create-cli facade-backed guidance requires owner naming before implementation
  - structured recovery diagnostics need stable contract ownership
  - deferring owner naming risks drift between help, parser, result shape, and tests
```

Decision:

- Name contract, result model, parser or engine, help or discovery, CLI, tests, and benchmark owners in the plan.
- Use file paths where known.
- Keep owner names conceptual only where implementation has not created files yet.

Rationale:

- Owner naming reduces ambiguity before coding.
- The facade-backed lane has more drift surfaces than a small basic script.
- Paths and owner roles together are clearer than paths alone.

Consequences:

- The plan should include owner roles in relevant units.
- Implementation should preserve or refine owner mapping as files land.
- Skill prose should point to owner paths instead of copying contracts.

Next:

- Decide evidence bundle location.

## Decision 40: Generated Skill-Local Evidence Artifact

```yaml
id: test-runner-compact-runner-040
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Where should benchmark evidence bundles live?
  option: 1
  confidence: soft
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - benchmark artifacts
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - benchmark output is generated evidence
  - committing raw or routine benchmark artifacts can create churn
  - deprecation review may later promote a selected report intentionally
```

Decision:

- Write benchmark evidence bundles under a skill-local generated output path.
- Keep generated artifacts git-ignored unless explicitly promoted.
- Allow a selected report to be promoted into docs only when deprecation review needs committed evidence.

Rationale:

- Generated outputs should not become source by default.
- Skill-local output keeps ownership clear.
- The pick is soft because final deprecation review may need a committed report.

Consequences:

- The benchmark harness should name the artifact path.
- `.gitignore` or local artifact conventions may need an update during implementation.
- Docs evidence files should be deliberate, not automatic.

Next:

- Decide skill reference docs.

## Decision 41: No Reference Doc In V1

```yaml
id: test-runner-compact-runner-041
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Should the skill include reference docs in v1?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/SKILL.md
  - runner help
  - runner tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - skill-design philosophy says add references only when depth would bloat SKILL.md
  - runner help and tests already own deterministic behavior
  - an early reference doc adds another drift surface
```

Decision:

- Do not add a skill reference doc in v1.
- Let `SKILL.md` point to runner help and tests.
- Add a reference only if skill prose starts to bloat or a repeated workflow needs one.

Rationale:

- V1 should stay thin and checkable.
- Help and tests are better owners for deterministic runner detail.
- Reference docs should earn their way through observed complexity.

Consequences:

- Implementation should avoid `skills/test-runner/references/` unless a real need appears.
- Skill validation should check that `SKILL.md` stays route-oriented.
- Generated help should not be copied into markdown by default.

Next:

- Decide whether to stop before implementation.

## Decision 42: Stop Before Implementation

```yaml
id: test-runner-compact-runner-042
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Should this session stop after brainstorm, plan, and decision log?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - decision log
  - implementation plan
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - issue 172 says no implementation occurs before brainstorm and plan are complete
  - the user explicitly said this is the end of the road for now
  - remaining work is implementation, not more decision grilling
```

Decision:

- Stop after the brainstorm, plan, and decision log are settled.
- Do not implement the runner in this session.
- Resume implementation only after an explicit request.

Rationale:

- The planning and decision work is complete enough for handoff.
- Continuing into code would violate the user's stop signal.
- Implementation can start cleanly from the plan and accepted decisions.

Consequences:

- No code, dependency, branch, staging, or commit actions happen now.
- Final validation should cover docs only.
- The next safe action is explicit implementation kickoff.

Next:

- Stop.

## Decision 43: MCP Baseline Waiver Gate

```yaml
id: test-runner-compact-runner-043
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Should MCP deprecation require an incumbent MCP baseline?
  option: 2
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - adoption evidence bundle
  - context/bun-runner.md
  - rules/code-quality.md
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - MCP skipped can prove local runner progress but does not compare against the incumbent path being deprecated
  - MCP tool availability can become circular when the target state is no MCP runner dependency
  - a maintainer waiver keeps the exception explicit and reviewable
```

Decision:

- Let MCP-skipped benchmark runs complete local runner proof.
- Block MCP guidance deprecation when the incumbent MCP baseline is skipped unless the evidence bundle records an explicit maintainer waiver.
- Require the waiver to explain why deprecation can proceed without same-fixture MCP comparison.

Rationale:

- Deprecating an incumbent path should normally compare against that path.
- Local proof should not fail just because MCP is unavailable.
- A waiver preserves the no-MCP target without making skipped evidence silently sufficient.

Consequences:

- U1 needs an MCP baseline artifact boundary or skipped state.
- U5 needs a deprecation gate that distinguishes local proof success from MCP deprecation eligibility.
- Evidence bundles must surface MCP baseline status and waiver status.

Next:

- Resolve the MCP baseline artifact shape.

## Decision 44: Agent-Generated MCP Baseline Artifact

```yaml
id: test-runner-compact-runner-044
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should carry the incumbent MCP baseline?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - benchmark evidence input
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - MCP runner access is an agent tool surface, not a normal local script API
  - a client adapter would add machinery before the local proof needs it
  - the evidence bundle still needs incumbent data when deprecation is considered
```

Decision:

- Carry incumbent MCP baseline data through an agent-generated JSON artifact.
- Have a tool-capable agent run `bun_runTests` or `bun_testFile` against the same fixtures and write the compact MCP result into the benchmark evidence input path.
- Let the harness consume that artifact when present and mark MCP skipped when absent.

Rationale:

- The benchmark script remains local and dependency-light.
- The artifact boundary reflects where MCP access actually exists.
- Deprecation can still compare against the incumbent without embedding MCP client machinery in v1.

Consequences:

- U1 must define the MCP baseline input path and expected artifact role.
- U5 must require the artifact or a maintainer waiver for MCP guidance deprecation.
- The harness should report missing, stale, or fixture-mismatched MCP artifacts as skipped or invalid evidence.

Next:

- Resolve proof-only skill routing before adoption.

## Decision 45: Proof-Only Skill Before Adoption

```yaml
id: test-runner-compact-runner-045
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should the initial skill route before gates pass?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/SKILL.md
  - context/bun-runner.md
  - rules/code-quality.md
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - adding a discoverable skill can create preference drift before benchmark proof
  - current MCP guidance remains active until U5 passes
  - the skill still needs to exist for benchmark and development proof
```

Decision:

- Make the initial `test-runner` skill proof-only.
- Route benchmark and development proof work to the local runner.
- Tell agents to keep using current MCP guidance for normal test runs until U5 passes and guidance is updated.

Rationale:

- The local runner should be discoverable for proof without becoming preferred prematurely.
- Existing startup and rule guidance remain the active normal-use contract during proof.
- U5 can update skill routing after the evidence gate passes.

Consequences:

- U4 must write `SKILL.md` with proof-only routing.
- U5 must update the skill route if local runner guidance replaces MCP guidance.
- Validation should scan for wording that makes the local runner the default before adoption.

Next:

- Resolve missing-Bun ownership.

## Decision 46: Shell Wrapper Owns Missing-Bun Diagnostic

```yaml
id: test-runner-compact-runner-046
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Who owns the missing-Bun path?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/scripts/test-runner.sh
  - wrapper-level tests
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - the shell wrapper runs before TypeScript can emit facade-backed diagnostics
  - missing Bun is an expected runner failure mode
  - install prose alone would not satisfy the runtime diagnostic requirement
```

Decision:

- Have `test-runner.sh` check `command -v bun` before invoking TypeScript.
- Emit a minimal missing-Bun diagnostic in plain and JSON modes from the wrapper.
- Cover the missing-Bun path with wrapper-level tests.

Rationale:

- The TypeScript runner cannot run when Bun is absent.
- The stable command entrypoint must still fail usefully.
- A wrapper-owned minimal diagnostic makes R9 executable.

Consequences:

- U3 owns missing-Bun preflight behavior.
- U2 owns diagnostics after Bun can start the TypeScript runner.
- Help and tests must document the wrapper-level missing-Bun boundary.

Next:

- Resolve concrete facade contract owner.

## Decision 47: Dedicated Command Contract Module

```yaml
id: test-runner-compact-runner-047
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What owns the runner command contract?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/scripts/command-contract.ts
  - skills/test-runner/scripts/test-runner.test.ts
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - facade-backed validation needs a concrete local source owner
  - burying contract metadata in the runner risks help, parser, and runtime drift
  - SKILL.md must not own deterministic contract details
```

Decision:

- Add `skills/test-runner/scripts/command-contract.ts` as the runner command contract and discovery owner.
- Keep result vocabulary, command metadata, diagnostic categories, and facade-backed contract construction in that module where applicable.
- Make `test-runner.test.ts` assert help, parser acceptance, and runtime results against the contract owner.

Rationale:

- A dedicated contract module gives implementation one inspectable source of truth.
- Tests can prove help, argv behavior, and runtime semantics stay aligned.
- The skill can point to owner paths without copying deterministic details.

Consequences:

- U2 owns `command-contract.ts` creation.
- U3 help rendering should derive from or validate against the contract owner.
- Owner placeholders such as "facade-backed runner contract" should resolve to this path.

Next:

- Resolve adoption gate calibration versus acceptance.

## Decision 48: Two-Run Adoption Gate

```yaml
id: test-runner-compact-runner-048
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should exact gates work?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - adoption evidence bundle
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - selecting thresholds from the same run that passes them is post-hoc
  - MCP deprecation needs a real falsification test
  - calibration and acceptance evidence should be separable in review
```

Decision:

- Use the first benchmark run to calibrate candidate exact gates.
- Record the fixed gates in the evidence bundle.
- Rerun the benchmark against those fixed gates; only the subsequent run can approve MCP guidance deprecation.

Rationale:

- The first run teaches what numbers are realistic.
- The second run proves the runner passes gates chosen before acceptance.
- Separating calibration from acceptance keeps the deprecation proof honest.

Consequences:

- U1 should produce calibration output.
- U5 should require a fixed-gate acceptance run before guidance changes.
- Evidence bundles need to distinguish calibration results from acceptance results.

Next:

- Resolve U1 closure scope before U2.

## Decision 49: Scaffold-Only Harness Unit

```yaml
id: test-runner-compact-runner-049
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should U1 be scoped?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - Runner Benchmark Harness
  - implementation plan
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - U1 cannot verify local-runner comparison before U2 creates the runner
  - harness-first sequencing still needs an independently reviewable first unit
  - local-runner scoring belongs after the wrapper exists
```

Decision:

- Scope U1 as a scaffold-only harness and fixture unit.
- Keep fixture creation, native Bun baseline path, MCP artifact/skipped handling, output shape, and calibration plumbing in U1.
- Move local-runner comparison rows, two-axis scoring against the local wrapper, and fixed-gate acceptance verification to U5 after U2 exists.

Rationale:

- U1 should close without depending on U2 deliverables.
- Harness-first still holds because fixture and output scaffolding land early.
- Acceptance scoring needs the local runner to exist.

Consequences:

- U1 verification should avoid local-runner acceptance claims.
- U5 becomes the first unit that can fully compare native, MCP, and local runner.
- The plan should separate calibration scaffolding from adoption evidence.

Next:

- Resolve facade dependency preflight.

## Decision 50: Facade Dependency Preflight

```yaml
id: test-runner-compact-runner-050
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should implementation handle facade runtime availability?
  option: 1
  confidence: strong
scope: skills/test-runner
owner:
  - skills/test-runner/scripts/package.json
  - skills/test-runner/scripts/command-contract.ts
  - implementation evidence
durability:
  current: decision-log
  reflected_in_brainstorm: true
  reflected_in_plan: true
evidence:
  - facade-backed runner work depends on facade runtime availability
  - repo instructions require asking before new dependencies
  - implementation needs an explicit stop point if the private runtime is missing
```

Decision:

- Start U2 with a facade runtime preflight from `skills/test-runner/scripts`.
- Resolve `@side-quest/cli-command-facade` before implementing the facade-backed contract.
- If the runtime is missing, stop and ask before editing `package.json` or adding a dependency.

Rationale:

- The dependency policy becomes enforceable.
- The implementer does not silently choose between adding a dependency and building a local substitute.
- The preflight creates inspectable implementation evidence before contract work starts.

Consequences:

- U2 must include a first-step preflight and verification check.
- Implementation evidence should record whether facade runtime resolution succeeded.
- `package.json` changes require explicit maintainer approval when the runtime is missing.

Next:

- Review remaining findings or stop.
