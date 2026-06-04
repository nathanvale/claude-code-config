---
title: Fallow Agent-Native Decision Log
type: decision-log
status: in-progress
date: "2026-06-04"
timezone: Australia/Melbourne
owner: skills/fallow
source:
  - docs/research/2026-06-04-fallow-ai-code-quality-tool.md
  - docs/research/2026-06-04-fallow-agent-lens.md
decision_metadata_format: fenced-yaml-per-decision
---

# Fallow Agent-Native Decision Log

Use this log for decisions made while designing the Fallow skill and its agent-native runner surface.

## Design Frame So Far

Accepted direction:

- Treat Fallow as deterministic analyzer evidence for agent self-review.
- Build a repo-native Fallow skill instead of installing the official Fallow skill verbatim.
- Use the official Fallow skill, docs, CLI help, and runtime output as owner sources.
- Keep exact Fallow command contracts out of `SKILL.md`.
- Use `create-cli` Agent-native CLI design as the wrapper rubric.

Agent-native lens:

- Discoverable: the skill tells agents when to call the runner.
- Non-interactive: runner does not prompt in agent mode.
- Parseable: runner emits one stable JSON envelope.
- Repairable: failures classify cause and expose one next safe action.
- Observable: envelope includes run id, command, cwd, exit code, and stderr category.
- Safe: writes are previewed; destructive apply requires an explicit later decision.
- Thin: Fallow owns analysis; the runner owns command normalization and recovery hints.

Skill shape:

```text
skills/fallow/
  SKILL.md
  PROVENANCE.md
  references/
    commands.md
    workflows.md
    safety.md
    ci.md
  scripts/
    fallow-runner.ts
```

Hot path:

- Preflight JS/TS project and Fallow availability.
- Choose one Fallow mode for the current task.
- Run through `scripts/fallow-runner.ts`.
- Summarize counts, failure category, and next safe action.
- Preview writes before apply.
- Rerun after changes.
- Report before/after when a rerun exists.

Mode map:

- Changed work: `audit`.
- Cleanup: `dead-code`.
- Duplication: `dupes`.
- Complexity: `health`.
- Fix preview: `fix --dry-run`.
- Fix apply: explicit apply mode.
- Diagnostics: `doctor`.

Composition:

- V1 does not invoke `find-the-slop`, `prevent-the-slop`, or review skills.
- V1 only provides Fallow analyzer evidence and runner recovery.
- Cross-skill handoff is future composition, not v1 behavior.
- Future composition may route architecture pressure to `find-the-slop`.
- Future composition may route planned-state guardrails to `prevent-the-slop`.

V1 runner envelope sketch:

```json
{
  "status": "ok|issues|blocked",
  "mode": "audit|dead-code|dupes|health|fix-preview|fix-apply|doctor",
  "run_id": "fallow:<timestamp>:<short-random>",
  "command": ["fallow", "audit", "--format", "json", "--quiet"],
  "cwd": "/repo",
  "exit_code": 0,
  "stderr_category": "empty|progress|warning|error",
  "failure_category": "none|setup|input|fallow|parse|budget|safety",
  "write_effect": "none|previewed|applied",
  "fallow_output": null,
  "output_budget": {},
  "summary": {
    "total_findings": 0,
    "auto_fixable": 0,
    "needs_trace": 0,
    "needs_human": 0
  },
  "repair_hints": [
    {
      "action": "run-doctor",
      "message": "Run diagnostics before retrying.",
      "retry_safe": false
    }
  ]
}
```

V1 exclusions:

- Do not own thresholds.
- Do not own baselines.
- Do not own CI policy.
- Do not own refactor plans.
- Do not auto-install Fallow.
- Do not invoke other skills.
- Do not copy Fallow schemas, flags, issue catalogues, MCP tool lists, or config fields.
- Do not enable telemetry.
- Do not run `fallow watch`.

Open decision queue:

- Start implementation planning in a new `ce-plan` session.

## Decision 1: Skill Purpose

```yaml
id: fallow-agent-native-001
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What is skills/fallow primarily for?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-skill
durability:
  current: decision-log
  escalate_to_plan_if: implementation starts
evidence:
  - Fallow emits structured JSON with issue actions and auto-fixability hints
  - Fallow audit targets PR-introduced regressions
  - existing review and architecture skills already own broader cleanup and design judgment
```

Decision:

- Make `skills/fallow` an agent-native self-review runner.
- Run Fallow after agent implementation.
- Use Fallow evidence to catch dead code, duplication, complexity, and cleanup regressions.

Rationale:

- Fallow's distinctive value is the agent self-review loop.
- V1 should prove Fallow evidence and runner recovery before cross-skill composition.

Consequences:

- Keep the Fallow skill thin.
- Do not turn the skill into a full Fallow manual.
- Prefer JSON output and measured reruns over prose judgment.
- Do not invoke other skills in v1.
- Record cross-skill handoff as future composition only.

Next:

- Decision 2 accepted the v1 wrapper boundary.

## Decision 2: Wrapper Boundary V1

```yaml
id: fallow-agent-native-002
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What is the wrapper boundary for v1?
  option: 1
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner
durability:
  current: decision-log
  escalate_to_plan_if: scripts/fallow-runner is implemented
agent_native_lane: runner-facade
evidence:
  - create-cli requires discoverable, non-interactive, parseable, repairable command surfaces
  - a runner facade proves the command envelope before workflow policy is added
  - Fallow already owns analysis semantics
```

Decision:

- Build v1 as a Runner Facade.
- Normalize one Fallow command into a stable JSON envelope.
- Let `SKILL.md` own the workflow.
- Let Fallow own analysis.

Rationale:

- Start with the smallest agent-native surface that can be proven.
- Avoid overbuilding scan-preview-apply-rerun policy before the envelope is trusted.
- Keep exact Fallow contracts in Fallow docs, CLI help, and runtime output.

Consequences:

- The wrapper should report command, exit code, parsed output, failure category, and repair hint.
- The wrapper should not own thresholds, baselines, CI policy, or refactor plans in v1.
- Workflow Facade remains a possible v2 after the Runner Facade is boring.
- Facade-backed CLI remains out of scope unless explicitly chosen later.

Next:

- Decision 3 accepted run recovery plus thin finding triage.

## Decision 3: Repair Hint Depth

```yaml
id: fallow-agent-native-003
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What repair hints should v1 own?
  option: 3
  confidence: soft
scope: skills/fallow/scripts
owner:
  - fallow-runner
durability:
  current: decision-log
  escalate_to_plan_if: scripts/fallow-runner is implemented
repair_hint_boundary:
  run_recovery: true
  finding_triage: aggregate-only
  per_finding_plans: false
evidence:
  - command repair is required when Fallow cannot run or JSON cannot parse
  - aggregate finding counts expose current-run state without owning refactor policy
  - per-finding strategy would turn the runner into a workflow facade too early
```

Decision:

- V1 owns both run recovery and thin finding triage.
- Run recovery classifies command failures and emits one next safe action.
- Finding triage emits aggregate counts only.
- Do not emit per-finding repair plans in v1.

Rationale:

- A Runner Facade should help agents recover from unusable runs.
- A Runner Facade should expose enough successful-run state for safe next-action selection.
- Aggregate counts preserve the v1 boundary.

Consequences:

- Include repair hints for missing binary, non-JS/TS repo, bad base ref, invalid config, JSON parse failure, and unusable stdout.
- Include summary counts such as total findings, auto-fixable, needs trace, and needs human review when Fallow output supports them.
- Do not decide suppression, deletion, refactor, or cross-skill handoff from the runner.
- Keep exact Fallow finding shapes runtime-owned by Fallow.

Next:

- Decision 4 accepted explicit apply mode.

## Decision 4: Fix Apply Policy

```yaml
id: fallow-agent-native-004
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should v1 do with fallow fix --yes?
  option: 2
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner
durability:
  current: decision-log
  escalate_to_plan_if: scripts/fallow-runner is implemented
write_policy:
  default: preview-only
  apply_mode: explicit
  auto_apply: false
evidence:
  - Fallow fix can mutate source files
  - create-cli requires explicit execute mode for destructive or externally visible writes
  - preview and apply should be separately testable command paths
```

Decision:

- Default v1 behavior is observe and preview.
- V1 may run `fallow fix --dry-run`.
- V1 may run `fallow fix --yes` only through an explicit apply mode or flag.
- V1 never auto-applies safe fixes after a scan.

Rationale:

- Preserve agent-native repair without surprise mutation.
- Keep write behavior intentional and testable.
- Separate finding evidence from source mutation.

Consequences:

- The runner needs distinct preview and apply modes.
- The apply path must be visible in command, envelope, and logs.
- Non-interactive apply requires explicit intent.
- The skill should default to preview and ask before apply unless the user already requested apply.

Next:

- Decision 5 accepted facade-backed implementation from day one.

## Decision 5: Runner Implementation Path

```yaml
id: fallow-agent-native-005
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should scripts/fallow-runner.ts be implemented in v1?
  option: 3
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-model
  - fallow-runner-engine
  - fallow-runner-discovery
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
implementation_path: facade-backed
create_cli_lane: Facade-backed CLI
evidence:
  - user explicitly requested create-cli tool direction
  - create-cli facade-backed path fits reusable runtime validation and drift proof
  - v1 runner is an agent-facing command surface with stable JSON and repair hints
```

Decision:

- Implement the v1 runner as facade-backed from day one.
- Use `create-cli` as the design front door.
- Name contract, model, engine, discovery, CLI, and test owners before coding.
- Use facade runtime validation for the command surface.

Rationale:

- The runner is intentionally agent-native, parseable, repairable, and observable.
- Facade-backed implementation prevents help, discovery, argv behavior, and runtime semantics from drifting.
- The added structure is justified because the runner is the skill's agent-facing product surface.

Consequences:

- Implementation must read `skills/create-cli/references/agent-native-cli-design.md`.
- Implementation must read `skills/create-cli/references/cli-command-facade.md`.
- Exact facade contract shape stays in the facade owner paths, not in skill prose.
- Tests must prove discovery metadata, rendered help, parser acceptance/rejection, and runtime semantics align.
- The v1 scope remains Runner Facade; facade-backed does not authorize Workflow Facade behavior.

Next:

- Decision 6 accepted CI as reference-only.

## Decision 6: CI Setup Boundary

```yaml
id: fallow-agent-native-006
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Where does CI setup belong?
  option: 2
  confidence: strong
scope: skills/fallow/references
owner:
  - fallow-skill
  - fallow-ci-reference
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
ci_boundary:
  v1_runner_support: false
  reference_only: true
  workflow_generation: false
evidence:
  - v1 production direction is local agent-native self-review
  - Fallow CI adoption matters after a clean baseline
  - runner support for CI setup would widen v1 beyond Runner Facade
```

Decision:

- Keep CI setup out of the v1 runner.
- Include CI setup as reference-only guidance.
- Do not generate GitHub Actions workflows in v1.

Rationale:

- CI is part of the adoption story, not the first runner product.
- Reference guidance can preserve the clean-baseline-before-audit-gate lesson.
- Runner modes should stay focused on Fallow command execution and recovery.

Consequences:

- Add `references/ci.md` or include CI under `references/workflows.md`.
- Link official Fallow CI docs and GitHub Action source.
- State that the recommended sequence is full-repo cleanup first, then PR `audit` gate.
- Do not add a `ci init`, workflow generator, or provider mutation path in v1.

Next:

- Decision 7 accepted a tiny router skill.

## Decision 7: Skill File And Reference Split

```yaml
id: fallow-agent-native-007
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should we split SKILL.md and references?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-skill
  - fallow-references
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
skill_shape:
  skill_md: tiny-router
  references:
    - commands.md
    - workflows.md
    - safety.md
    - ci.md
evidence:
  - repo skill philosophy says skill bodies route and code/docs own deterministic contracts
  - official Fallow skill is useful source material but too large for this repo's hot path
  - facade-backed runner will own parseable command behavior and tests
```

Decision:

- Keep `SKILL.md` as a tiny router.
- Put command recipes, workflow details, safety depth, and CI adoption notes in references.
- Keep exact runtime contracts in runner code, tests, help, and Fallow owner docs.

Rationale:

- Agents should load the minimum hot path first.
- References can be pulled only when the task needs them.
- The skill should not become a Fallow manual.

Consequences:

- `SKILL.md` should include purpose, triggers, v1 flow, safety gates, and owner paths only.
- `references/commands.md` owns mode map and examples.
- `references/workflows.md` owns self-review, cleanup baseline, and rerun loops.
- `references/safety.md` owns apply policy, config trust, telemetry, and watch guardrails.
- `references/ci.md` owns reference-only CI adoption notes.

Next:

- Decision 8 accepted evidence, fix preview, explicit apply, and doctor modes.

## Decision 8: V1 Runner Command Modes

```yaml
id: fallow-agent-native-008
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What v1 runner command modes should exist?
  option: 3
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
runner_modes:
  evidence:
    - audit
    - dead-code
    - dupes
    - health
  write:
    - fix-preview
    - fix-apply
  diagnostics:
    - doctor
evidence:
  - evidence modes cover changed work, cleanup, duplication, and complexity
  - explicit apply policy needs a separately testable apply command path
  - doctor supports create-cli diagnostic capability and run recovery
```

Decision:

- Include evidence modes: `audit`, `dead-code`, `dupes`, and `health`.
- Include write modes: `fix-preview` and `fix-apply`.
- Include diagnostics mode: `doctor`.

Rationale:

- V1 should cover the agent self-review loop without owning workflow orchestration.
- Preview and apply should be separate public modes.
- `doctor` gives agents a safe diagnostics path before guessing repairs.

Consequences:

- `fix-apply` must require explicit invocation.
- `fix-preview` maps to Fallow dry-run behavior.
- `doctor` should inspect runner/Fallow readiness without mutating source.
- Tests must cover each advertised mode in help, parser acceptance, and runtime semantics.

Next:

- Decision 9 accepted three top-level status values.

## Decision 9: Envelope Status Vocabulary

```yaml
id: fallow-agent-native-009
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should the top-level envelope status values be?
  option: 1
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-model
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
status_values:
  - ok
  - issues
  - blocked
evidence:
  - status should describe run outcome rather than command mode
  - write preview/apply state can live in a separate field
  - fewer top-level states are easier for agents to branch on safely
```

Decision:

- Use exactly three top-level status values: `ok`, `issues`, and `blocked`.
- Keep write result out of top-level status.
- Represent preview/apply state with a separate field.

Rationale:

- `status` should answer whether the runner completed, found actionable issues, or could not produce usable evidence.
- `mode` already identifies the command path.
- `write_effect` can represent preview/apply without multiplying status states.

Consequences:

- Evidence modes return `ok` when no findings surfaced.
- Evidence modes return `issues` when Fallow surfaced findings.
- Unusable runs return `blocked`.
- `fix-preview` and `fix-apply` use `write_effect` for mutation state.

Next:

- Decision 10 accepted three write effect values.

## Decision 10: Write Effect Vocabulary

```yaml
id: fallow-agent-native-010
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should write_effect values be?
  option: 1
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-model
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
write_effect_values:
  - none
  - previewed
  - applied
evidence:
  - write_effect should describe write side effects, not failure state
  - status already owns unusable-run state with blocked
  - preview and apply need separate agent-readable values
```

Decision:

- Use exactly three write effect values: `none`, `previewed`, and `applied`.
- Use `none` when no source mutation path ran.
- Use `previewed` when a dry-run or preview path produced write evidence without mutating source.
- Use `applied` only when an explicit apply path ran and completed.
- Keep failed or unusable write attempts in `status: blocked`.

Rationale:

- The field should answer what write effect occurred.
- Failure classification belongs to status and failure category.
- Agent-readable values are clearer than runtime jargon.

Consequences:

- Evidence modes use `write_effect: none`.
- `fix-preview` uses `write_effect: previewed` when Fallow returns usable preview evidence.
- `fix-apply` uses `write_effect: applied` only after explicit apply completes.
- Failed preview or apply runs return `status: blocked` with a failure category and repair hint.

Next:

- Decision 11 accepted coarse failure categories.

## Decision 11: Failure Category Vocabulary

```yaml
id: fallow-agent-native-011
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should the failure category vocabulary be?
  option: 1
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-model
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
failure_category_values:
  - none
  - setup
  - input
  - fallow
  - parse
  - budget
  - safety
evidence:
  - failure category should choose the agent's recovery branch
  - repair hints can carry specific next actions without widening the category vocabulary
  - coarse categories are stable enough for v1 tests and agent branching
```

Decision:

- Use exactly seven failure category values: `none`, `setup`, `input`, `fallow`, `parse`, `budget`, and `safety`.
- Use `none` when the runner produced usable evidence.
- Use `setup` for missing tools, unsupported project shape, or environment readiness failures.
- Use `input` for invalid arguments, roots, modes, or base refs.
- Use `fallow` when Fallow runs but fails before producing usable evidence.
- Use `parse` when stdout cannot be parsed into usable JSON.
- Use `budget` when output must be limited to stay agent-readable.
- Use `safety` when policy blocks a requested action.

Rationale:

- Categories should route recovery, not catalogue every cause.
- Specific causes belong in repair hints, diagnostics, stderr category, and Fallow output.
- Keeping one category per blocked run simplifies agent control flow.

Consequences:

- Non-blocked envelopes use `failure_category: none`.
- Blocked envelopes use one non-`none` category.
- Tests should cover category selection for representative blocked paths.
- Do not add `failure_code` in v1 unless implementation evidence shows repair hints are too weak.

Next:

- Decision 12 accepted structured repair hints.

## Decision 12: Repair Hint Shape

```yaml
id: fallow-agent-native-012
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What shape should repair_hints use?
  option: 2
  confidence: soft
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-model
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
repair_hint_shape: structured-objects
minimum_fields:
  - action
  - message
  - retry_safe
evidence:
  - agent-native recovery should not require scraping prose
  - retry safety prevents blind same-input loops
  - structured hints keep recovery branchable while human-readable
```

Decision:

- Use structured objects for `repair_hints`.
- Include an agent-branchable `action`.
- Include a human-readable `message`.
- Include `retry_safe` for same-input retry safety.
- Keep exact action literals in the runner contract, tests, help, and runtime output.

Rationale:

- String hints hide command contracts in prose.
- Action keys let agents choose recovery without parsing text.
- Retry safety is part of the recovery contract, not an implementation detail.

Consequences:

- Successful runs may return an empty repair hint list.
- Blocked runs should return at least one repair hint when a safe next action is known.
- The runner should not emit per-finding repair plans in v1.
- Do not expand repair hints into a full workflow state machine in v1.

Next:

- Decision 13 accepted `doctor` as a normal runner mode.

## Decision 13: Doctor Command Shape

```yaml
id: fallow-agent-native-013
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Should doctor be a normal runner mode or a separate top-level command?
  option: 1
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
doctor_shape: normal-runner-mode
evidence:
  - Decision 8 already includes doctor in v1 runner modes
  - one command surface lowers discovery and test drift
  - diagnostics should share the same envelope and repair hint behavior
```

Decision:

- Keep `doctor` as a normal runner mode.
- Do not create a separate `fallow-doctor` command in v1.
- Keep diagnostics inside the same command discovery, help, parser, and envelope surface.

Rationale:

- One surface is easier for agents to discover.
- One surface is easier to prove with Command Surface Alignment tests.
- Separate diagnostics can wait until real usage shows the main surface is overloaded.

Consequences:

- Help and discovery metadata advertise `doctor` with the other modes.
- Parser tests accept `doctor` through the normal mode path.
- Runtime tests assert `doctor` returns the standard envelope.
- Structured repair hints may point agents to `doctor` without introducing another executable.

Next:

- Decision 14 accepted summary default plus explicit raw output.

## Decision 14: Fallow Output Handling

```yaml
id: fallow-agent-native-014
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should fallow_output work in v1?
  option: 2
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-model
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
output_handling: summary-default-raw-explicit
evidence:
  - agent runs need compact evidence by default
  - raw Fallow JSON can become token-heavy
  - raw output remains useful for debugging and deeper inspection
```

Decision:

- Include normalized summary by default.
- Omit raw parsed Fallow JSON by default.
- Include raw parsed Fallow JSON only when an explicit flag requests it.
- Keep exact raw-output omission metadata in the runner contract, tests, help, and runtime output.

Rationale:

- The default envelope should be agent-readable.
- Agents should not reason over large raw payloads unless they asked for them.
- Explicit raw output preserves inspectability without bloating the hot path.

Consequences:

- The envelope sketch uses `fallow_output: null` for default raw omission.
- Summary remains present when Fallow output can be parsed.
- Raw output requests still obey the output budget decision.
- Tests should prove default omission and explicit inclusion behavior.

Next:

- Decision 15 accepted summary-preserving output budget behavior.

## Decision 15: Output Budget Behavior

```yaml
id: fallow-agent-native-015
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should v1 do when Fallow output exceeds the runner budget?
  option: 1
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-model
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
budget_behavior: keep-summary-mark-budget-metadata
evidence:
  - summary can remain usable when raw output is too large
  - blocking on budget would discard useful analyzer evidence
  - persisted artifacts add cleanup and retention policy outside v1
```

Decision:

- Keep normalized summary when raw Fallow output exceeds budget.
- Omit raw output when it exceeds budget.
- Mark budget state in envelope metadata.
- Keep exact budget metadata fields in the runner contract, tests, help, and runtime output.

Rationale:

- Agents need usable evidence more than raw payload completeness.
- Partial raw output is risky because agents may reason over truncated data.
- Temp artifacts would widen v1 into persistence policy.

Consequences:

- Large raw output does not automatically make the run `blocked`.
- Use `failure_category: budget` only when budget prevents the runner from producing usable summary evidence.
- Explicit raw-output requests still receive budget metadata when raw output is omitted.
- Tests should cover default omission, explicit raw omission, and budget-preserved summary behavior.

Next:

- Decision 16 accepted `--root` only.

## Decision 16: Root And Cwd Flags

```yaml
id: fallow-agent-native-016
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Should v1 support --root only, or also explicit --cwd?
  option: 1
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
path_targeting: root-only
evidence:
  - target repo root is the user-facing path concept
  - explicit cwd creates a second path concept for agents
  - skill-driven calls need a path flag instead of relying only on process cwd
```

Decision:

- Support `--root` as the public repo targeting flag.
- Do not add public `--cwd` in v1.
- Treat command cwd as runner implementation state.
- Report execution cwd in the envelope when useful for observability.

Rationale:

- Agents need one targeting concept.
- `--root` names the domain object: the repo being analyzed.
- Public `--cwd` invites accidental divergence between target repo and process location.

Consequences:

- Help and parser tests advertise `--root`, not `--cwd`.
- Runtime tests cover explicit root and default current-directory root behavior.
- Invalid roots use `failure_category: input`.
- Missing or unsupported repo shape uses `failure_category: setup`.

Next:

- Decision 17 accepted optional audit base ref.

## Decision 17: Audit Base Ref Handling

```yaml
id: fallow-agent-native-017
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should base refs be passed for audit?
  option: 1
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
audit_base_ref: optional-runner-flag
evidence:
  - Fallow audit has a default base behavior
  - research shows Fallow also supports explicit base refs for PR workflows
  - local self-review should not require base-ref ceremony
```

Decision:

- Support optional base-ref input for `audit`.
- Do not require a base ref for local self-review.
- Pass explicit base-ref input through to Fallow when provided.
- Keep exact public flag spelling in the runner contract, help, tests, and runtime output.

Rationale:

- Agents sometimes know the PR base and should be able to state it.
- Fallow defaults remain useful when no base ref is provided.
- Required base refs would make the common local path heavier than needed.

Consequences:

- Help and parser tests cover `audit` with and without base-ref input.
- Runtime tests assert explicit base refs are reflected in the executed command.
- Invalid base refs use `failure_category: input`.
- Do not add baseline or gate-policy ownership in v1.

Next:

- Decision 18 accepted strong defaults as a batch.

## Decision 18: Strong Defaults Batch

```yaml
id: fallow-agent-native-018
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Which strong recommendations are accepted as v1 defaults?
  option: accepted-strong-batch
  confidence: strong
scope: skills/fallow
owner:
  - fallow-skill
  - fallow-references
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
accepted_defaults:
  - config_trust_in_doctor_and_safety_reference
  - root_defaults_to_current_directory
  - base_ref_flag_for_audit_only
  - omit_raw_output_instead_of_truncating
  - no_auto_install
  - no_telemetry
  - no_watch_mode
  - explicit_fix_apply_only
  - exact_command_echo
  - aggregate_summary_only
  - tiny_skill_router
  - cli_design_brief_before_coding
  - safety_category_for_unexplicit_apply
  - doctor_read_only
  - doctor_status_ok_or_blocked
  - issues_status_only_for_analyzer_findings
  - coarse_stderr_category
  - non_json_stdout_is_parse_failure
  - missing_git_for_audit_is_setup_failure
  - invalid_base_ref_is_input_failure
  - no_baselines
  - no_ci_workflow_generation
  - no_runner_invoked_skills
  - tests_own_runner_contract
```

Decision:

- Accept the strong recommendations as v1 defaults.
- Treat prior accepted decisions as source when this batch repeats them.
- Keep exact schema fields, flags, action literals, help text, and test helpers in runner owner paths.
- Keep exact Fallow contracts in Fallow owner docs, CLI help, runtime output, runner code, and tests.

Runtime defaults:

- Default `--root` to the current directory.
- Expose base-ref input only for `audit`.
- Echo the exact executed Fallow argv in the envelope.
- Keep `stderr_category` coarse: `empty`, `progress`, `warning`, and `error`.
- Treat non-JSON stdout from Fallow as `failure_category: parse`.
- Treat missing git for `audit` as `failure_category: setup`.
- Treat invalid base ref as `failure_category: input`.

Safety defaults:

- Check config trust in `doctor`.
- Explain config trust in `references/safety.md`.
- Keep `doctor` read-only.
- Return `doctor` as `status: ok` when ready.
- Return `doctor` as `status: blocked` when not ready.
- Use `failure_category: safety` when apply is requested outside explicit `fix-apply`.
- Do not auto-install Fallow.
- Do not enable or configure telemetry.
- Do not support watch mode in v1.

Scope defaults:

- Use `status: issues` only for analyzer findings.
- Keep summary aggregate-only.
- Do not emit per-finding repair plans.
- Do not support baselines in v1.
- Do not generate CI workflows in v1.
- Do not invoke other skills from the runner.
- Keep `SKILL.md` as a tiny router.
- Put workflow depth in `references/`.

Proof defaults:

- Write a CLI design brief before coding `scripts/fallow-runner.ts`.
- Let tests own the runner contract.
- Prove help, discovery metadata, argv acceptance and rejection, mode semantics, budget behavior, and blocked-run repair hints.

Next:

- Decision 19 accepted subcommand mode shape.

## Decision 19: Mode Command Shape

```yaml
id: fallow-agent-native-019
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should modes be expressed?
  option: 1
  confidence: soft
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
mode_shape: subcommands
evidence:
  - subcommands match common CLI habits
  - subcommands keep mode choice visible in help
  - dual subcommand and flag support would increase drift risk
```

Decision:

- Express runner modes as subcommands.
- Do not add a public `--mode` flag in v1.
- Keep exact command grammar in the runner contract, help, tests, and runtime output.

Rationale:

- Humans and agents can both read subcommand intent quickly.
- Help can group each mode with mode-specific flags.
- One mode path keeps parser and discovery proof smaller.

Consequences:

- Example shape: `fallow-runner audit --root .`.
- Parser tests cover each accepted subcommand.
- Help tests cover each accepted subcommand.
- Runtime tests assert subcommands map to the expected Fallow argv.

Next:

- Decision 20 accepted `--include-raw-output`.

## Decision 20: Raw Output Flag Name

```yaml
id: fallow-agent-native-020
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should the raw output flag be named?
  option: 1
  confidence: soft
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
raw_output_flag: --include-raw-output
evidence:
  - explicit flag names reduce agent ambiguity
  - raw output is exceptional rather than the default path
  - short raw wording does not say what payload is included
```

Decision:

- Use `--include-raw-output` for explicit raw parsed Fallow output.
- Do not add `--raw` in v1.
- Keep exact help text and parser behavior in the runner contract and tests.

Rationale:

- The flag should say what changes in the envelope.
- Longer spelling is acceptable for an uncommon inspection path.
- Clear public flags reduce driver guesswork.

Consequences:

- Help tests advertise `--include-raw-output`.
- Parser tests accept `--include-raw-output`.
- Runtime tests prove raw output remains omitted unless the flag is present and budget allows it.

Next:

- Decision 21 accepted public output budget control.

## Decision 21: Output Budget Control

```yaml
id: fallow-agent-native-021
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: Should output budget control be public or internal?
  option: 1
  confidence: soft
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
output_budget_flag: --max-output-bytes
evidence:
  - output budgets need testable edge cases
  - agents may need tighter budgets in constrained contexts
  - a public flag is easier to discover than a hidden environment variable
```

Decision:

- Expose `--max-output-bytes` as the public output budget control.
- Keep the default budget value in the runner contract, help, tests, and runtime output.
- Do not use an env-only budget control in v1.

Rationale:

- Budget behavior is part of the agent-facing contract.
- Public control makes budget tests direct.
- Hidden env vars are harder for skill-driven agents to discover.

Consequences:

- Help tests advertise `--max-output-bytes`.
- Parser tests cover valid and invalid budget values.
- Runtime tests cover budget-preserved summary behavior using a small budget.
- Envelope budget metadata should report the applied budget.

Next:

- Decision 22 accepted local-first Fallow binary resolution.

## Decision 22: Fallow Binary Resolution

```yaml
id: fallow-agent-native-022
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How should the runner resolve the Fallow binary?
  option: 1
  confidence: soft
scope: skills/fallow/scripts
owner:
  - fallow-runner-discovery
  - fallow-runner-engine
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
binary_resolution: local-project-then-path
evidence:
  - JS/TS projects often pin tool versions locally
  - PATH fallback keeps global installs usable
  - explicit binary paths add ceremony before evidence shows need
```

Decision:

- Prefer repo-local Fallow resolution.
- Fall back to PATH resolution.
- Do not require an explicit binary path in v1.
- Do not auto-install Fallow.
- Keep exact probing logic in runner discovery code and tests.

Rationale:

- Repo-local tools best match project expectations.
- PATH fallback keeps the runner ergonomic.
- Auto-install would mutate environment outside the v1 safety boundary.

Consequences:

- `doctor` reports which resolution path is used.
- Missing binary uses `failure_category: setup`.
- Repair hints point to install or setup guidance without running install commands.
- Tests cover local, PATH, and missing-binary paths.

Next:

- Decision 23 accepted bounded doctor diagnostics.

## Decision 23: Doctor Check Scope

```yaml
id: fallow-agent-native-023
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should doctor check in v1?
  option: 2
  confidence: soft
scope: skills/fallow/scripts
owner:
  - fallow-runner-discovery
  - fallow-runner-engine
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
doctor_scope: bounded-diagnostics
evidence:
  - doctor already owns readiness and config trust signals
  - local binary resolution and version signals help repair setup failures
  - deep probing would add v1 surface before usage evidence exists
```

Decision:

- Use bounded diagnostics for `doctor`.
- Include binary readiness.
- Include binary resolution source.
- Include version when cheap and safe to read.
- Include repo shape readiness.
- Include git readiness for `audit`.
- Include JSON-capable command path readiness.
- Include config presence.
- Include config trust signal.
- Exclude base-ref probing unless an `audit` run uses the base ref.
- Exclude install commands.
- Exclude deep config parsing.
- Exclude `--deep` in v1.

Rationale:

- `doctor` should make setup failures repairable.
- Bounded diagnostics preserve the Runner Facade boundary.
- Rich diagnostics should still avoid becoming install policy or config policy.

Consequences:

- `doctor` stays read-only.
- `doctor` returns the standard envelope.
- `doctor` returns `status: ok` when ready.
- `doctor` returns `status: blocked` when readiness prevents useful runs.
- Tests cover included checks and v1 exclusions.

Next:

- Decision 24 accepted config presence and path signals.

## Decision 24: Config Trust Depth

```yaml
id: fallow-agent-native-024
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How deep should config trust checks go?
  option: 1
  confidence: soft
scope: skills/fallow
owner:
  - fallow-runner-discovery
  - fallow-runner-tests
  - fallow-safety-reference
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
config_trust_depth: presence-and-paths
evidence:
  - config trust is a safety signal, not a Fallow config linter
  - parsing Fallow config would make the runner own Fallow semantics
  - safety guidance can teach inspection without duplicating config contracts
```

Decision:

- `doctor` reports config presence.
- `doctor` reports config paths.
- `doctor` does not parse Fallow config semantics.
- `doctor` does not judge config policy.
- `fix-apply` surfaces a config-present safety hint before mutation.
- `references/safety.md` owns config inspection guidance.

Rationale:

- The runner should expose inspectable state.
- Fallow owns config meaning.
- Agents need a safety prompt before mutation when inherited config exists.

Consequences:

- Config presence does not block evidence modes by itself.
- Config presence can add repair or safety hints.
- Tests cover config-present and config-absent doctor output.
- Tests do not assert Fallow config semantic judgments in v1.

Next:

- Decision 25 accepted a tiny repair hint action vocabulary.

## Decision 25: Repair Hint Action Vocabulary

```yaml
id: fallow-agent-native-025
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: How large should the repair hint action vocabulary be?
  option: 1
  confidence: soft
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-model
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: skills/fallow is implemented
repair_hint_action_vocabulary: tiny-fixed-set
candidate_actions:
  - run-doctor
  - setup-fallow
  - fix-input
  - inspect-config
  - reduce-output
  - retry
evidence:
  - repair hint actions are agent branch keys
  - freeform action strings would force text matching
  - broad action vocabularies invite per-finding workflow drift
```

Decision:

- Use a tiny fixed action vocabulary for `repair_hints.action`.
- Keep exact action literals in the runner contract, tests, help, and runtime output.
- Do not use freeform action strings in v1.
- Do not add install-sounding actions that imply the runner mutates environment.
- Do not duplicate `retry_safe` with action names such as `retry-after-repair`.

Rationale:

- Agents need branchable actions.
- Specific cause belongs in `message`, failure category, diagnostics, and command output.
- A tiny action set protects the Runner Facade boundary.

Consequences:

- `setup-fallow` points to setup guidance without installing Fallow.
- `fix-input` covers invalid root, invalid base ref, unsupported flag, and similar user-fixable inputs.
- `reduce-output` covers budget-related recovery.
- `retry` is allowed only when `retry_safe` makes same-input retry safe.
- Tests should reject unknown action literals.

Next:

- Decision 26 closed the MVP v1 decision queue and routed implementation planning to `ce-plan`.

## Decision 26: Implementation Readiness

```yaml
id: fallow-agent-native-026
status: accepted
decided_at: "2026-06-04"
decision_mode:
  question: What should happen next?
  option: 1
  confidence: soft
scope: skills/fallow
owner:
  - fallow-plan
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: ce-plan starts
readiness: decisions-closed-plan-next
next_skill: ce-plan
```

Decision:

- Close the MVP v1 decision queue.
- Start implementation planning in a new `ce-plan` session.
- Build the plan before implementation.
- Keep the accepted decisions as source constraints.

Rationale:

- V1 product and runner boundaries are now decided.
- The next useful artifact is a portable implementation plan.
- `ce-plan` owns sequencing, implementation units, file paths, and test scenarios.

Consequences:

- Do not start coding until the CLI design brief and implementation plan exist.
- Use repo-relative paths in the plan.
- Preserve the Runner Facade boundary.
- Keep exact runtime contracts in code, help, generated docs, and tests.

Next:

- Paste the handoff prompt into a new `ce-plan` session.

## Decision 27: Resolver Surface Shape

```yaml
id: fallow-agent-native-027
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: What should the next Fallow resolver work define as the primary product shape?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-skill
  - fallow-runner-contract
  - fallow-runner-model
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
resolver_surface_shape: actions-first
source:
  - docs/ideation/2026-06-05-fallow-why-resolver-ideation.md
```

Decision:

- Use actions-first resolver design.
- Let findings advertise resolver actions.
- Treat `why` as a continuation when trace can change the decision.
- Do not make routine audit triage depend on a visible `why` command.

Rationale:

- Per-finding actions give agents the next safe move at the point of decision.
- Audit attribution already handles zero-introduced stop.
- A command-first design would make agents remember another route before the finding proves it is worth tracing.

Consequences:

- Requirements should center finding-level continuation, not command marketing.
- `SKILL.md` should route to the owner surfaces without copying resolver contracts.
- Runner contract and tests own exact action literals, command targets, and output semantics.

Next:

- Decision 28 accepted runnable targets for finding resolver actions.

## Decision 28: Finding Resolver Action Target

```yaml
id: fallow-agent-native-028
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: In v1, does an advertised resolver action need a runnable command target?
  option: 1
  confidence: strong
scope: skills/fallow/scripts
owner:
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
resolver_action_target: runnable-target
language:
  canonical_term: Finding resolver action
  glossary_owner: CONTEXT.md
```

Decision:

- A finding resolver action includes a runnable target.
- Keep resolver actions distinct from blocked-run repair actions.
- Use the canonical term `Finding resolver action`.
- Avoid hidden command plumbing as the primary design.
- Avoid metadata-only resolver hints in v1.

Rationale:

- Agent-native continuations need mechanical follow-through.
- Metadata-only hints invite prose interpretation.
- Hidden commands create discovery drift.
- `CONTEXT.md` now defines the term and distinguishes it from repair actions.

Consequences:

- Findings that advertise a resolver action must provide enough structured input for the target.
- Command discovery, rendered help, parser acceptance, and runtime semantics must stay aligned before the surface ships.
- The runner owns exact command target semantics.

Next:

- Decision 29 accepted introduced traceable findings as the v1 advertising scope.

## Decision 29: Resolver Action Advertising Scope

```yaml
id: fallow-agent-native-029
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: Which findings may advertise a finding resolver action in v1?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-runner-model
  - fallow-runner-output
  - fallow-workflow-reference
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
resolver_action_advertising_scope: introduced-traceable-findings-only
evidence:
  - audit attribution separates introduced findings from inherited findings
  - introduced=0 means stop without per-finding triage
  - trace_export needs file plus export name
```

Decision:

- Advertise finding resolver actions only for introduced traceable findings in v1.
- Do not advertise resolver actions for inherited findings in normal audit output.
- Do not advertise resolver actions when the finding lacks the required trace target.

Rationale:

- This preserves audit attribution as the first gate.
- It prevents inherited baseline noise from regaining per-finding triage pressure.
- It keeps resolver action availability tied to a runnable target.

Consequences:

- Ad hoc cleanup can use a later explicit manual path if needed.
- Non-audit modes still need attribution or baseline/regression work before broad resolver action advertising.
- Plain output should continue to stop on zero introduced findings.

Next:

- Decision 30 accepted decision-log tracking for follower work.

## Decision 30: Resolver Work Decision Tracking

```yaml
id: fallow-agent-native-030
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: How should follow-on resolver work preserve decisions as they crystallise?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-decision-log
  - fallow-brainstorm
  - fallow-plan
durability:
  current: decision-log
  escalate_to_adr_if:
    - the decision is hard to reverse
    - the decision would surprise a future maintainer
    - the decision resolves a real trade-off
decision_tracking: append-to-fallow-decision-log-as-we-go
```

Decision:

- Track resolver design decisions in this Fallow decision log as they are made.
- Let follower planning and implementation work read this log as source context.
- Create ADRs only when the ADR threshold is met.
- Keep requirements and plans linked back to this log when they inherit these decisions.

Rationale:

- The Fallow decision log already owns agent-native runner decisions.
- Inline decision capture reduces handoff drift.
- ADRs would be too heavy for reversible product-shape decisions at this stage.

Consequences:

- Brainstorm requirements should cite this decision log as a source.
- Planning should not rediscover accepted resolver boundaries.
- Implementation workers should preserve these decisions unless a new decision explicitly supersedes them.

Next:

- Decision 31 accepted the v1 traceable finding boundary.

## Decision 31: V1 Traceable Finding Boundary

```yaml
id: fallow-agent-native-031
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: What counts as traceable in v1?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-runner-model
  - fallow-runner-output
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
traceable_finding_boundary: introduced-remove-export-with-file-and-export
language:
  canonical_term: Traceable finding
  glossary_owner: CONTEXT.md
evidence:
  - trace_export was proven only for export reachability
  - trace_export requires file plus export_name
  - runner issue references already carry path, action, symbol, and introduced when present
```

Decision:

- In v1, treat only introduced `remove-export` findings with file and export coordinates as traceable findings.
- Do not treat every `needs_trace` signal as traceable.
- Do not introduce a resolver registry in v1.

Rationale:

- The prototype proved exactly one resolver shape.
- `needs_trace` is too broad until the runner can prove a runnable target.
- A registry is attractive later, but premature before one resolver is boring.

Consequences:

- Resolver action advertising is narrow and testable.
- Missing file or export coordinate means no resolver action is advertised.
- Inherited `remove-export` findings do not advertise resolver actions in normal audit output.
- Broader finding-kind resolver work stays deferred.

Next:

- Decision 32 accepted coordinate-addressed resolver targets for v1.

## Decision 32: V1 Resolver Target Addressing

```yaml
id: fallow-agent-native-032
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: How should the runnable target be addressed in v1?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-runner-contract
  - fallow-runner-cli
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
resolver_target_addressing: coordinates-first
target_coordinates:
  - file
  - export
evidence:
  - prototype proved file plus export_name
  - finding-id resolution needs persisted envelope or last-run state
  - runner issue references already expose path and symbol when present
```

Decision:

- Address v1 resolver targets with file plus export coordinates.
- Do not require finding-id resolution in v1.
- Do not add last-run state in v1.

Rationale:

- Coordinates match the proven `trace_export` input.
- Finding-id addressing creates persistence and lookup questions beyond the resolver's core value.
- Existing issue references can carry the coordinates the user or agent needs.

Consequences:

- Finding resolver actions can render a runnable coordinate-addressed target.
- A later finding-id shortcut may be added after envelope persistence or command history exists.
- Parser and help design should prove coordinate addressing mechanically.

Next:

- Decision 33 accepted evidence grade as the resolver meaning source.

## Decision 33: Resolver Result Meaning

```yaml
id: fallow-agent-native-033
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: What should the resolver target return as its main meaning?
  option: 3
  confidence: soft
scope: skills/fallow
owner:
  - fallow-runner-contract
  - fallow-runner-output
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
resolver_result_meaning: evidence-grade-primary-derived-verdict
candidate_evidence_grades:
  - referenced
  - entry_point
  - unreferenced_by_trace
  - unresolved
  - trace_unavailable
derived_verdict_role: plain-output-and-branch-helper
```

Decision:

- Make evidence grade the primary resolver result meaning.
- Derive verdict and next action from the evidence grade.
- Do not make deletion verdict the source of truth.
- Avoid numeric confidence in v1.

Rationale:

- Static trace evidence proves graph reachability under configured roots, not universal runtime deletion safety.
- Agents still need branchable plain output.
- Evidence grades keep the JSON contract honest while derived verdicts keep routine reading fast.

Consequences:

- JSON output should expose the evidence grade and raw supporting graph facts.
- Plain output may render a concise derived verdict.
- `unreferenced_by_trace` is a deletion candidate, not automatic deletion permission.
- `trace_unavailable` and `unresolved` block action rather than becoming weak deletion verdicts.

Next:

- Decision 34 accepted the resolver MVP boundary.

## Decision 34: Resolver MVP Boundary

```yaml
id: fallow-agent-native-034
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: What recommendations define the resolver MVP?
  option: strong-recommendation-bundle
  confidence: strong
scope: skills/fallow
owner:
  - fallow-brainstorm
  - fallow-plan
  - fallow-runner-contract
  - fallow-runner-output
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
mvp_boundary:
  surface: actions-first
  eligible_findings: introduced-traceable-remove-export-only
  target_addressing: coordinates-first
  top_level_status: reuse-ok-issues-blocked
  resolver_meaning: evidence-grade-primary
  verdict_role: derived-helper
  transport_owner: fallow-owned-mcporter-adapter
  cli_surface_gate:
    - discovery-metadata
    - rendered-help
    - parser-acceptance
    - runtime-semantics
v2_capture:
  - finding-id-addressing
  - resolver-registry
  - non-audit-baseline-regression
  - batch-trace
  - broader-trace-family
  - shared-mcporter-utility-after-third-consumer
  - trace-evidence-ledger
  - cleanup-mode-resolver-actions
```

Decision:

- Build the resolver MVP around introduced traceable `remove-export` findings.
- Advertise Finding resolver actions from findings, not from routine audit prose.
- Use coordinate-addressed runnable targets in v1.
- Keep top-level runner status as `ok | issues | blocked`.
- Put resolver grade and supporting graph evidence inside mode evidence.
- Keep derived verdicts and next actions as helpers.
- Keep mcporter behind a Fallow-owned evidence adapter.
- Capture v2 candidates without expanding MVP scope.

Rationale:

- The MVP should prove one boring resolver before growing a trace framework.
- The accepted boundary preserves audit attribution as the first gate.
- Agent-native value comes from mechanical continuations with testable discovery, not prose hints.

Consequences:

- `why` is not the product center; resolver actions are.
- A visible command may exist only as the runnable target behind an advertised resolver action.
- Planning should treat v2 candidates as parking-lot scope unless a later decision promotes them.

Next:

- Decision 35 rejected `likely-dead` wording in the MVP.

## Decision 35: Resolver Wording Safety

```yaml
id: fallow-agent-native-035
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: How should MVP wording avoid overclaiming deletion safety?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-runner-output
  - fallow-runner-tests
  - fallow-workflow-reference
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
wording_boundary:
  avoid_in_mvp:
    - likely-dead
  prefer:
    - unreferenced_by_trace
    - candidate_remove
```

Decision:

- Avoid `likely-dead` in the resolver MVP.
- Use evidence wording such as `unreferenced_by_trace`.
- Use action wording such as `candidate_remove`.
- Do not present static trace absence as deletion proof.

Rationale:

- `likely-dead` reads like a verdict.
- `unreferenced_by_trace` reads like evidence.
- The resolver should reduce false positives without creating deletion overconfidence.

Consequences:

- JSON evidence grades avoid `likely-dead`.
- Plain output avoids `likely-dead`.
- Deletion remains a candidate action that needs judgment or follow-up verification.

Next:

- Decision 36 accepted tiny resolver action payloads.

## Decision 36: Resolver Action Payload Size

```yaml
id: fallow-agent-native-036
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: How much metadata should a finding resolver action carry?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-runner-model
  - fallow-runner-output
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
resolver_action_payload_size: tiny
payload_members_conceptual:
  - action-id
  - target-command
  - required-coordinates
  - reason
```

Decision:

- Keep Finding resolver action payloads tiny.
- Include only action id, runnable target, required coordinates, and reason.
- Do not copy command help into issue references.
- Do not copy expected output shape into issue references.

Rationale:

- Issue references should stay scannable.
- Command discovery and help own command detail.
- Tests and runtime contracts own exact output semantics.

Consequences:

- Resolver action payloads point to owner surfaces instead of duplicating them.
- Richer resolver explanation appears only after running the resolver target.
- Payload drift risk stays low.

Next:

- Decision 37 accepted visible but secondary resolver command discovery.

## Decision 37: Resolver Command Visibility

```yaml
id: fallow-agent-native-037
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: How visible should the resolver command be?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-runner-discovery
  - fallow-runner-cli
  - fallow-skill
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
resolver_command_visibility: visible-but-secondary
```

Decision:

- Make the resolver command discoverable through help and command discovery.
- Keep docs and route guidance centered on Finding resolver actions.
- Do not hide the runnable command.
- Do not make command-first UX the primary teaching path.

Rationale:

- Runnable targets need mechanical discovery.
- Hidden commands create drift.
- Actions-first UX can coexist with visible command discovery.

Consequences:

- `SKILL.md` should not market `why` as routine audit triage.
- Command references may name the resolver target as the action continuation.
- Discovery, help, parser acceptance, and runtime semantics stay required gates.

Next:

- Decision 38 separated `needs_trace` from Traceable finding.

## Decision 38: Trace Signal Vocabulary Boundary

```yaml
id: fallow-agent-native-038
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: How should `needs_trace` relate to Traceable finding?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-runner-model
  - fallow-runner-output
  - fallow-workflow-reference
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
trace_signal_boundary:
  needs_trace: broad-summary-signal
  traceable_finding: runnable-action-gate
```

Decision:

- Keep `needs_trace` separate from Traceable finding.
- Treat `needs_trace` as broad summary or analyzer signal.
- Treat Traceable finding as the gate for advertising a Finding resolver action.
- Do not rename `needs_trace` in the resolver MVP.

Rationale:

- Existing runner summary already uses `needs_trace`.
- Renaming it would broaden the MVP.
- Collapsing the concepts would advertise resolver actions too broadly.

Consequences:

- Resolver eligibility checks should not rely on `needs_trace` alone.
- Requirements should define Traceable finding in terms of runnable coordinates and attribution.
- Later cleanup may rename or refine `needs_trace` if real confusion appears.

Next:

- Decision 39 accepted docs-route/code-contract ownership.

## Decision 39: Resolver Documentation Boundary

```yaml
id: fallow-agent-native-039
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: How should docs describe resolver actions without copying contracts?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-skill
  - fallow-workflow-reference
  - fallow-runner-contract
  - fallow-runner-tests
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
documentation_boundary: docs-route-code-owns-contract
```

Decision:

- Use docs to route agents to resolver actions.
- Keep exact payloads, flags, literals, parser rules, and output semantics in code, help, generated discovery, and tests.
- Do not copy resolver contracts into `SKILL.md`.
- Do not omit resolver routing from docs once the surface exists.

Rationale:

- Skills own workflows.
- Runtime code and checks own deterministic contracts.
- Prose examples with literals drift faster than command discovery and tests.

Consequences:

- Requirements should name owner surfaces, not exact schemas.
- `SKILL.md` can say when to follow a Finding resolver action.
- `references/workflows.md` can explain the audit gate and cleanup boundary.

Next:

- Decision 40 accepted v2 parking-lot scope control.

## Decision 40: Resolver V2 Scope Control

```yaml
id: fallow-agent-native-040
status: accepted
decided_at: "2026-06-05"
decision_mode:
  question: How should v2 ideas be captured without expanding the resolver MVP?
  option: 1
  confidence: strong
scope: skills/fallow
owner:
  - fallow-brainstorm
  - fallow-plan
durability:
  current: decision-log
  escalate_to_plan_if: resolver implementation starts
v2_scope_control: parking-lot-only
```

Decision:

- Capture v2 candidates in a parking lot only.
- Do not turn v2 candidates into MVP acceptance criteria.
- Do not add inline future hooks to every MVP requirement.
- Do not design the MVP as a resolver framework.

Rationale:

- The MVP should prove one resolver path.
- Parking-lot capture preserves future ideas without expanding implementation scope.
- Frameworking now would weaken the accepted narrow traceable-finding boundary.

Consequences:

- Requirements should separate MVP scope from v2 parking lot.
- Planning should ignore v2 items unless a later decision promotes one.
- Implementation workers should treat v2 mentions as non-goals.
