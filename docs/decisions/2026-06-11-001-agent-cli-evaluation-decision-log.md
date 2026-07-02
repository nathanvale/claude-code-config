---
title: Agent CLI Evaluation Decision Log
slug: agent-cli-evaluation
type: decision-log
status: in-progress
date: "2026-06-11"
timezone: Australia/Melbourne
owner: agent-cli-evaluation
source:
  - "2026-06-11 Codex session: agent CLI evaluation"
decision_metadata_format: fenced-yaml-per-decision
---

# Agent CLI Evaluation Decision Log

Use this log for accepted decisions made while evaluating other agent CLI tools and deciding what to adopt for our own agent-native CLI patterns.

## Frame

- Compare real CLI implementations before extracting patterns.
- Look for observability, repair loops, continuation hints, architecture boundaries, and file/folder structure.
- Preserve accepted decisions as entries.
- Keep unresolved observations in `Notes` until accepted.
- Escalate only durable, hard-to-reverse architecture choices to ADRs.

## Notes

- Evaluate CLI observability: run ids, structured output, stderr policy, event streams, traces, logs, and machine-readable summaries.
- Evaluate repair behavior: diagnostics, retry safety, next actions, partial-write handling, and human handoff.
- Evaluate architecture: seams, interfaces, protocol boundaries, generated contracts, runtime ownership, and folder structure.
- Evaluate CLI UX: discoverability, help text, parser behavior, dry-run support, non-interactive mode, and output stability.
- Preserve uncertain ideas here until Nathan accepts them as decisions.
- Promote an observation to a decision entry only after acceptance or an explicit preserve request.
- Playwright Python v1.58.0 global CLI resolves through pyenv, Python `playwright.__main__`, bundled Node driver, and Node `lib/cli/program.js`.
- Playwright's public CLI is human-first; most public commands do not expose JSON, correlation ids, structured error categories, side-effect labels, or retry safety.
- Playwright has hidden machine seams: `run-driver` JSON over stdio, `run-server` WebSocket, `launch-server` browser WebSocket endpoint, and `print-api-json` generated API schema output.
- Playwright's install registry seam is strongly agent-useful: `install --dry-run` reveals planned artifacts, paths, and URLs; `install --list` maps browser caches to owning Playwright versions.
- Playwright's JS test stubs show a useful missing-capability pattern: register known unavailable commands and explain the install path.
- `cli-execution-auditor` is currently facade-lane-only; raw Playwright is not a valid audit target because it lacks `@side-quest/cli-command-facade` and `src/command-contract.ts`.
- Running `cli-execution-auditor` against Playwright's bundled Node package returned a usage error on missing `src`; this suggests the auditor's non-facade skip path may need hardening for arbitrary package roots.
- Candidate split: keep `cli-execution-auditor` for our facade-backed CLIs, and use a separate external CLI evaluation rubric or adapter for third-party tools like Playwright.
- Formal Playwright rubric pass: `docs/research/2026-06-11-playwright-cli-rubric-evaluation.md`.
- Formal Agent Browser rubric pass: `docs/research/2026-06-11-agent-browser-cli-rubric-evaluation.md`.
- Formal Codex CLI rubric pass: `docs/research/2026-06-11-codex-cli-rubric-evaluation.md`.
- Formal Gemini CLI rubric pass: `docs/research/2026-06-11-gemini-cli-rubric-evaluation.md`.
- Formal Aider CLI rubric pass: `docs/research/2026-06-11-aider-cli-rubric-evaluation.md`.
- Formal claude-tap CLI rubric pass: `docs/research/2026-06-11-claude-tap-cli-rubric-evaluation.md`.

## Decision 1: Keep Unresolved Evaluation Material In Notes

```yaml
id: agent-cli-evaluation-001
status: accepted
decided_at: "2026-06-11"
decision: Keep unresolved evaluation material in Notes until accepted
owner: agent-cli-evaluation
source:
  - "2026-06-11 Codex session: agent CLI evaluation"
```

Decision:

- Use this decision log during agent CLI evaluation sessions.
- Record accepted choices as decision entries.
- Keep uncertain observations, candidates, and maybe-decisions in top-level `Notes` until Nathan accepts or explicitly asks to preserve them.

Rationale:

- The session will collect many useful observations before they become decisions.
- Keeping unresolved material separate prevents the log from turning exploratory notes into false commitments.
- The split matches the `record-decision` boundary between accepted decisions and live decision-making.

Consequences:

- Future agents can safely treat decision entries as accepted.
- Future agents must treat `Notes` as evidence and candidate material, not policy.
- `decision-mode` remains the handoff for live unresolved choices.

Next:

- Add notes as we inspect each agent CLI tool.
- Append a new decision entry when Nathan accepts a pattern, exclusion, or architecture direction.

V2 Ideas:

- Add a helper that can promote a note into a validated decision entry after explicit acceptance.

## Decision 2: Use Playwright As A Seam Architecture Reference

```yaml
id: agent-cli-evaluation-002
status: accepted
decided_at: "2026-06-11"
decision: Use Playwright as a seam architecture reference, not as an agent-native CLI template
owner: agent-cli-evaluation
source:
  - "2026-06-11 Codex session: Playwright CLI evaluation"
```

Decision:

- Treat Playwright as evidence for strong runtime seams behind a thin CLI facade.
- Do not treat Playwright's public CLI as an agent-native CLI model.

Rationale:

- The installed CLI is a thin wrapper over a shared Node engine.
- The useful machine boundaries exist in hidden protocol commands, not in the public human command surface.
- The public CLI lacks the structured outputs and continuation metadata agents need by default.

Consequences:

- Future CLI design should copy the seam discipline, not the hiddenness.
- Playwright examples should be cited as "human CLI with protocol-grade escape hatches."
- Agent-native upgrades should expose machine seams intentionally.

Next:

- Compare the next agent CLI tool against the same seam-vs-surface distinction.

V2 Ideas:

- Keep a reusable evaluation rubric with separate scores for public CLI UX and hidden protocol seams.

## Decision 3: Expose Machine Seams As Public Agent Contracts

```yaml
id: agent-cli-evaluation-003
status: accepted
decided_at: "2026-06-11"
decision: Expose machine seams as public agent contracts
owner: agent-cli-evaluation
source:
  - "2026-06-11 Codex session: Playwright CLI evaluation"
```

Decision:

- Our agent-facing CLIs should expose machine seams intentionally.
- Public agent mode should include `--json`, stable error categories, side-effect labels, retry safety, continuation hints, and discovery metadata.

Rationale:

- Playwright's hidden seams are powerful, but agents have to know undocumented routes to use them.
- Agent-native CLIs should make the safe machine path discoverable through help, command metadata, and stable output contracts.

Consequences:

- Hidden protocol commands are not enough when agents are first-class users.
- CLI help and discovery output need to point to parseable contracts.
- Repair and continuation data belongs in the public agent surface, not only in internal runtime paths.

Next:

- Apply this as a default constraint when designing new helper CLIs with `cli-author`.

V2 Ideas:

- Define a standard `discover --json` shape for command catalog, side effects, output modes, and repair actions.

## Decision 4: Keep Executable Wrappers Boring

```yaml
id: agent-cli-evaluation-004
status: accepted
decided_at: "2026-06-11"
decision: Keep executable wrappers boring
owner: agent-cli-evaluation
source:
  - "2026-06-11 Codex session: Playwright CLI evaluation"
```

Decision:

- Keep language or package-specific executable wrappers thin.
- Wrappers should locate the runtime, forward argv, preserve exit codes, and inject minimal environment metadata.
- Shared command behavior should live in one engine.

Rationale:

- Playwright Python delegates to the bundled Node driver instead of reimplementing CLI behavior.
- Thin wrappers reduce drift across language packages and installation surfaces.

Consequences:

- Cross-runtime CLIs should centralize parser and command behavior where possible.
- Wrapper tests should focus on delegation, environment, and exit-code preservation.
- Product behavior should be tested at the shared engine seam.

Next:

- Use this pattern when a future tool needs Python, Node, shell, or package-manager entrypoints over the same CLI behavior.

V2 Ideas:

- Add a wrapper conformance test pattern for argv forwarding, environment injection, and exit-code preservation.

## Decision 5: Organize CLI Runtime By Ownership Surface

```yaml
id: agent-cli-evaluation-005
status: accepted
decided_at: "2026-06-11"
decision: Organize CLI runtime by ownership surface
owner: agent-cli-evaluation
source:
  - "2026-06-11 Codex session: Playwright CLI evaluation"
```

Decision:

- Structure future agent CLI runtimes by ownership surface rather than by public command alone.
- Use owner folders for CLI routing, command handlers, contracts, model data, engine policy, discovery, runtime side effects, protocol transport, and generated artifacts.

Rationale:

- Playwright keeps CLI files thin while deeper ownership lives under client, server, remote, protocol, generated, and registry surfaces.
- Agents need maps to stable owners so they can inspect, repair, or extend the right layer.

Consequences:

- Command files should stay thin.
- Deterministic contracts should live in contract, protocol, generated, help, and tests.
- Runtime side effects should stay out of parser glue.
- Discovery and install/cache ownership deserve their own surface when present.

Next:

- Use this folder map as the starting default for future agent-native CLI work:

```text
src/
  cli/
  cli/commands/
  contract/
  model/
  engine/
  discovery/
  runtime/
  protocol/
  generated/
```

V2 Ideas:

- Add project-specific owner names only after a concrete runtime needs them.

## Decision 6: Do Not Hide Missing Capability Guidance

```yaml
id: agent-cli-evaluation-006
status: accepted
decided_at: "2026-06-11"
decision: Do not hide missing capability guidance
owner: agent-cli-evaluation
source:
  - "2026-06-11 Codex session: Playwright CLI evaluation"
```

Decision:

- Register known unavailable capabilities as helpful stubs when the command name is predictable.
- The stub should explain the missing dependency, install or setup path, and next safe action.

Rationale:

- Playwright's JS `programWithTestStub` pattern helps users recover when `@playwright/test` commands are unavailable.
- Python suppresses those stubs, so `playwright test` becomes a plain unknown command.
- Agents benefit from explicit missing-capability diagnostics more than from generic parser errors.

Consequences:

- Unknown-command handling should distinguish typos from known-but-unavailable capabilities.
- Agent-facing stubs should emit structured repair data in JSON mode.
- Human help should stay concise while still naming the install path.

Next:

- Include missing-capability stubs in future `cli-author` designs when the capability boundary is known.

V2 Ideas:

- Add a standard `missing_capability` error category with dependency, setup command, retry safety, and docs fields.

## Decision 7: Treat Discovery And Registry As A First-Class Agent CLI Seam

```yaml
id: agent-cli-evaluation-007
status: accepted
decided_at: "2026-06-11"
decision: Treat discovery and registry as a first-class agent CLI seam
owner: agent-cli-evaluation
source:
  - "2026-06-11 Codex session: Playwright CLI evaluation"
```

Decision:

- Give discovery and registry state an explicit CLI/runtime owner in future agent-facing tools.
- Include installed state, capability state, cache state, planned side effects, and ownership mappings in that seam.
- Make the seam inspectable through stable agent output, not only incidental human text.

Rationale:

- Playwright's `install --dry-run` and `install --list` outputs are among its most agent-useful surfaces.
- Agents need to know what exists, what will change, what owns cached artifacts, and what repair path is safe before mutating anything.
- Discovery and registry state often drives repair, setup, and next-action selection.

Consequences:

- Agent CLI designs should name discovery or registry owners when tools install, cache, probe, or resolve capabilities.
- Dry-run and list-style commands should be treated as primary agent affordances.
- Discovery output should be bounded, parseable, and explicit about side effects.

Next:

- Add discovery/registry checks to the evaluation rubric for the next agent CLI tool.
- Use `cli-author` to define the exact command contract before implementing any new discovery surface.

V2 Ideas:

- Define a reusable discovery envelope with installed items, planned mutations, owners, cache paths, source URLs, and repair actions.

## Decision 8: Evaluate External Agent CLIs With A Fixed Seam Rubric

```yaml
id: agent-cli-evaluation-008
status: accepted
decided_at: "2026-06-11"
decision: Evaluate external agent CLIs with a fixed seam rubric before adopting patterns
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - "2026-06-11 Codex session: agent CLI evaluation"
```

Decision:

- Use a fixed evaluation rubric when reviewing external agent CLI tools.
- Evaluate wrapper, facade, protocol seams, discovery and registry, repair and recovery, observability, and folder structure before adopting patterns.
- Keep public CLI UX and hidden machine seams as separate observations.

Rationale:

- A fixed rubric makes different tools comparable.
- Separate lanes prevent one strong pattern from hiding weak agent-native behavior elsewhere.
- The rubric turns exploration into reusable evidence for future CLI design.

Consequences:

- Future tool reviews should cite the rubric before extracting decisions.
- Candidate patterns stay as notes until accepted.
- `cli-author` remains the handoff before implementing any adopted CLI surface.

Next:

- Run the next CLI evaluation through `docs/research/2026-06-11-agent-cli-evaluation-rubric.md`.

V2 Ideas:

- Convert the capture template into a small helper once several manual evaluations reveal stable fields.

## Decision 9: Provide Command Discovery Metadata For Non-Trivial Agent CLIs

```yaml
id: agent-cli-evaluation-009
status: accepted
decided_at: "2026-06-11"
decision: Provide command discovery metadata for non-trivial agent CLIs
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - docs/research/2026-06-11-agent-browser-cli-rubric-evaluation.md
  - docs/research/2026-06-11-codex-cli-rubric-evaluation.md
  - docs/research/2026-06-11-gemini-cli-rubric-evaluation.md
```

Decision:

- Provide `discover --json` or an equivalent command metadata surface when an agent-facing CLI has more than a few commands.
- Include commands, args, flags, output modes, side-effect stance, examples, and owner hints.
- Treat agent-facing prose help as discovery support, not as the full command contract.

Rationale:

- Codex, Gemini, and Agent Browser all have rich command trees.
- Help text is useful, but agents still need parser-safe metadata for command choice and repair.
- Agent Browser's skill/help surface improves discovery but still leaves parser/help/machine-output drift risk.

Consequences:

- Future CLI designs should name a command discovery owner.
- Help output and discovery output should share command metadata where practical.
- `cli-author` should treat command discovery as a first-class recipe when command trees grow.

Next:

- Include command discovery in the proposed CLI seam contract.
- Use `cli-author` before implementing the exact `discover --json` surface.

V2 Ideas:

- Add a command-catalog shape with command ids, side-effect labels, output contracts, examples, and repair action ids.

## Decision 10: Cover Parser, Config, And Pre-Runtime Failures In Machine Output

```yaml
id: agent-cli-evaluation-010
status: accepted
decided_at: "2026-06-11"
decision: Cover parser, config, and pre-runtime failures in machine output
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-browser-cli-rubric-evaluation.md
  - docs/research/2026-06-11-codex-cli-rubric-evaluation.md
  - docs/research/2026-06-11-gemini-cli-rubric-evaluation.md
```

Decision:

- JSON mode should cover parser, config, trust, auth-readiness, and pre-runtime failures.
- Public JSONL or JSON error events should include category, retry safety, side-effect state, diagnostics pointer, and next safe action.
- Command-specific machine-output flags should either apply to the whole command path or fail with a command-specific explanation.

Rationale:

- Codex and Agent Browser expose useful runtime JSON, but some parser and config failures still return human text.
- Gemini exposes strong `json` and `stream-json` for prompt runs, but not for several registry subcommands.
- Agents need structured failures before runtime as much as during runtime.

Consequences:

- Parser glue becomes part of the agent contract.
- Config-loading and trust-gate failures need structured wrappers.
- Runtime JSON success without structured pre-runtime failure is incomplete.

Next:

- Include failure envelope requirements in the CLI seam contract.
- Keep exact field names in runtime contracts and tests, not decision prose.

V2 Ideas:

- Define shared categories for `usage`, `config`, `auth`, `trust`, `dependency`, `external_service`, `runtime`, and `interrupted`.

## Decision 11: Keep Discovery And Smoke Paths Read-Only By Default

```yaml
id: agent-cli-evaluation-011
status: accepted
decided_at: "2026-06-11"
decision: Keep discovery and smoke paths read-only by default
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-aider-cli-rubric-evaluation.md
  - docs/research/2026-06-11-claude-tap-cli-rubric-evaluation.md
  - docs/research/2026-06-11-playwright-cli-rubric-evaluation.md
```

Decision:

- Discovery commands should be read-only by default.
- CLI smoke commands should avoid auth, onboarding, git mutation, update checks, analytics writes, and long-running waits.
- Mutating repair should be separate from diagnostic reporting and require explicit execute intent.

Rationale:

- Aider discovery and smoke probes can trigger onboarding, analytics state writes, or git initialization unless carefully gated.
- Playwright's `install --dry-run` demonstrates useful mutation preview.
- claude-tap separates update checks and CA trust behind explicit flags or subcommands, but still needs clear smoke paths.

Consequences:

- New agent-facing CLIs should provide a safe smoke command.
- Doctor-style commands should stay read-mostly unless invoked with explicit repair flags.
- Agents can probe readiness without changing user state.

Next:

- Add smoke-path and discovery-side-effect rules to the CLI seam contract.
- Add checks for accidental mutation when a CLI grows discovery commands.

V2 Ideas:

- Standardize `doctor --json`, `doctor --fix`, and `smoke --json` semantics across helper CLIs.

## Decision 12: Create A CLI Seam Contract Before New Agent CLI Implementation

```yaml
id: agent-cli-evaluation-012
status: accepted
decided_at: "2026-06-11"
decision: Create a CLI seam contract before new agent CLI implementation
owner: agent-cli-evaluation
source:
  - "2026-06-11 Nathan request: CLI seam contract and architecture guidance"
  - docs/research/2026-06-11-playwright-cli-rubric-evaluation.md
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - skills/cli-author/references/agent-native-cli-design.md
```

Decision:

- Create a dedicated CLI seam contract before implementing new agent-native CLI patterns.
- Cover architecture, ownership boundaries, file structure, file naming, command metadata, protocol seams, discovery, recovery, observability, and tests.
- Use Playwright as a seam-architecture reference and compare it with domain-driven and ICA-style architecture guidance before finalizing the contract.

Rationale:

- The evaluations surfaced repeated decisions, but not yet a complete architectural contract.
- Playwright gives a strong example of thin CLI files over deeper runtime, protocol, generated, and registry owners.
- Agent-native CLI tools need file and owner guidance agents can navigate before editing.

Consequences:

- The next artifact should be a synthesis/contract document, not another isolated tool evaluation.
- Exact deterministic contracts should land in code, generated docs, CLI help, or checks after `cli-author`.
- The research pass can use DDD and ICA-style seam language without turning the decision log into policy prose.

Next:

- Draft `docs/research/2026-06-11-agent-cli-seam-contract.md`.
- Include a proposed file tree and naming guidance.
- Use `cli-author` before converting the contract into helper CLI behavior.
- Use architecture review skills after the draft if the contract proposes durable file structure rules.

V2 Ideas:

- Promote the contract into `cli-author` references after it survives one implementation.
- Add a mechanical checker only after repeated drift appears.

## Decision 13: Accept CLI Seam Principles And Ownership Surfaces

```yaml
id: agent-cli-evaluation-013
status: accepted
decided_at: "2026-06-11"
decision: Accept CLI seam principles and ownership surfaces while keeping exact file and command details draft
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-cli-seam-contract.md
  - skills/cli-author/references/agent-native-cli-design.md
  - "2026-06-11 Codex session: CLI seam contract grilling"
decision_mode:
  question: What should the seam contract become after grilling?
  option: Accept principles and ownership surfaces now; keep folder names, command names, and open questions draft.
  confidence: strong
```

Decision:

- Accept the CLI seam contract's principles as default guidance for new agent-native CLI work.
- Accept the contract's ownership surfaces as the default architecture map before implementation planning.
- Keep exact folder names, file tree shape, command names, shared vocabularies, and open questions draft until separately accepted or proven by an implementation.

Rationale:

- The evaluated tools support the same broad ownership surfaces: CLI, contract, model, engine, discovery, runtime, protocol, observability, generated artifacts, docs, and tests.
- Accepting principles and owners gives future agents a stable map without freezing unresolved details.
- Keeping exact names draft prevents the research artifact from becoming accidental policy.

Consequences:

- Future agent-native CLI plans can rely on the accepted principles and ownership surfaces.
- Future agents should not treat the proposed file tree or command spellings as accepted policy.
- Decision-mode remains the handoff for unresolved naming, discovery, recovery, privacy, MCP, and doctor-vocabulary choices.

Next:

- Continue grilling the candidate decisions one at a time.
- Record only accepted decisions in this log.
- Leave exact contract shape in code, generated docs, CLI help, or checks after `cli-author`.

V2 Ideas:

- Promote proven parts of the seam contract into `cli-author` references after a real implementation validates them.
- Add mechanical checks only after repeated drift appears.

## Decision 14: Require Alignment Proof When Public CLI Surfaces Can Drift

```yaml
id: agent-cli-evaluation-014
status: accepted
decided_at: "2026-06-11"
decision: Require command-surface alignment proof when public CLI surfaces can drift
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-cli-seam-contract.md
  - skills/cli-author/references/agent-native-cli-design.md
  - skills/cli-author/references/cli-guidelines.md
  - "2026-06-11 Codex session: CLI seam contract grilling"
decision_mode:
  question: When should command-surface alignment proof be required?
  option: "Required when public surfaces can drift: parser, help, discovery metadata, machine output, runtime semantics."
  confidence: strong
```

Decision:

- Require a command-surface alignment proof when parser behavior, rendered help, discovery metadata, machine output, or runtime semantics can drift.
- Do not require the proof for tiny CLI changes with no meaningful drift surface.
- Keep exact proof mechanics in code, generated docs, CLI help, or checks after `cli-author`.

Rationale:

- Agent-native CLIs depend on parser-safe discovery and stable machine output.
- Help text, discovery metadata, parser acceptance, and runtime semantics can diverge unless checked through one contract path.
- Requiring the proof only when drift is plausible avoids turning small helper edits into ceremony.

Consequences:

- Future non-trivial CLI work should name the surfaces that can drift before implementation.
- `cli-author` should carry the proof path for new or changed command surfaces.
- Reviews should reject prose-only claims that parser, help, discovery, output, and runtime behavior stay aligned.

Next:

- Apply this gate during future CLI implementation planning.
- Keep proof details owned by runtime code, generated artifacts, CLI help, or checks.

V2 Ideas:

- Add a reusable alignment checker after repeated implementations reveal stable inputs and diagnostics.

## Decision 15: Require Read-Only Machine Diagnostics And Explicit Repair Split

```yaml
id: agent-cli-evaluation-015
status: accepted
decided_at: "2026-06-11"
decision: Require read-only machine diagnostics and explicit mutating repair split for eligible agent-native CLIs
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-cli-seam-contract.md
  - skills/cli-author/references/agent-native-cli-design.md
  - skills/cli-author/references/cli-guidelines.md
  - "2026-06-11 Codex session: CLI seam contract grilling"
decision_mode:
  question: How should we standardize `doctor --json`?
  option: Standardize mandatory behavior for eligible CLIs, not exact command spelling.
  confidence: strong
```

Decision:

- Require read-only machine-readable diagnostics when readiness depends on environment, auth, config, service reachability, local dependencies, installed artifacts, caches, registries, protocols, or similar runtime state.
- Require mutating repair to be explicit and separate from diagnostic reporting.
- Treat `doctor --json` as the default example, not the only accepted command spelling.
- Keep exact command names, flags, fields, repair actions, and diagnostics in the implementation contract after `cli-author`.

Rationale:

- Agents need a safe readiness path before attempting repair or execution.
- Diagnostics and repair have different side-effect profiles.
- Mandating the behavior prevents future CLIs from hiding readiness checks in prose or mutating smoke paths.
- Leaving the spelling implementation-owned avoids freezing names before a concrete CLI earns them.

Consequences:

- Eligible agent-native CLIs need a non-mutating machine-readable diagnostic surface.
- Repair commands or flags need explicit execute intent before changing local, external, auth, billing, or user-visible state.
- Reviews should reject diagnostic paths that mutate state by default.
- Tiny CLIs without runtime readiness dependencies can avoid the diagnostic surface until the trigger applies.

Next:

- Apply this requirement through `cli-author` when planning eligible CLI surfaces.
- Keep exact diagnostic and repair contracts in code, generated docs, CLI help, or checks.

V2 Ideas:

- Standardize shared diagnostic vocabulary after several implementations reveal stable categories.
- Add a checker for diagnostic read-only behavior and repair split once the command shape stabilizes.

## Decision 16: Require Command Discovery Metadata Above Threshold

```yaml
id: agent-cli-evaluation-016
status: accepted
decided_at: "2026-06-11"
decision: Require command discovery metadata above the agent command-choice threshold without mandating exact command spelling
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-cli-seam-contract.md
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - skills/cli-author/references/agent-native-cli-design.md
  - "2026-06-11 Codex session: CLI seam contract grilling"
decision_mode:
  question: How should command discovery metadata be standardized beyond existing Decision 9?
  option: Mandate behavior above the threshold, not exact spelling.
  confidence: strong
```

Decision:

- Require machine-readable command discovery metadata when an agent-facing CLI has more than a few commands.
- Require machine-readable command discovery metadata when agents need to choose commands, compare side effects, select output modes, or route repair actions without prose guessing.
- Keep exact command spelling implementation-owned.
- Treat `discover --json` as the default example, not the only accepted command.

Rationale:

- Decision 9 accepted command discovery for non-trivial agent CLIs.
- This decision makes the trigger mandatory without freezing command names too early.
- Agents need parseable command metadata before command choice becomes a reasoning-heavy step.
- Local CLI language may already have a stronger discovery verb or noun.

Consequences:

- Future non-trivial CLI plans should name the discovery owner and threshold during `cli-author`.
- Reviews should reject prose-only command catalogs once the threshold applies.
- Exact metadata shape, command name, flag name, and validation live in runtime code, generated docs, CLI help, or checks.

Next:

- Apply the discovery trigger during future CLI planning.
- Keep the command spelling open until a concrete implementation chooses it.

V2 Ideas:

- Standardize a shared command catalog shape after multiple CLIs prove stable fields.
- Add a discovery alignment checker when parser, help, metadata, and runtime behavior drift in practice.

## Decision 17: Require Structured Failures For Machine And Agent Paths

```yaml
id: agent-cli-evaluation-017
status: accepted
decided_at: "2026-06-11"
decision: Require structured failure coverage when CLIs expose machine output or agent-facing surfaces
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-cli-seam-contract.md
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - skills/cli-author/references/agent-native-cli-design.md
  - "2026-06-11 Codex session: CLI seam contract grilling"
decision_mode:
  question: How should structured failure coverage be standardized beyond existing Decision 10?
  option: Mandatory when the CLI exposes machine output or is agent-facing.
  confidence: strong
```

Decision:

- Require structured failure coverage when a CLI exposes machine output or agent-facing surfaces.
- Preserve structured failure output for parser, config, trust, auth-readiness, dependency, missing-capability, interrupted, and pre-runtime failures under machine mode.
- Require structured failures to include category, retry safety, changed-state stance, diagnostics pointer when useful, and next safe action.
- Keep exact field names, categories, and envelope shape in implementation contracts after `cli-author`.

Rationale:

- Agents need repair data before runtime starts, not only after a command handler runs.
- Parser and config failures are common first-contact failures for non-interactive drivers.
- Human-text fallback under machine mode forces agents to scrape prose and guess recovery.

Consequences:

- Parser glue, config loading, and trust gates become part of the agent contract.
- Reviews should reject machine-output CLIs whose pre-runtime failures fall back to unstructured human text.
- Tiny human-only helper CLIs do not need this surface until they expose machine output or become agent-facing.

Next:

- Apply this gate during `cli-author` planning for machine-output and agent-facing CLIs.
- Keep exact failure contracts in code, generated docs, CLI help, or checks.

V2 Ideas:

- Standardize shared failure categories only after multiple implementations prove the category set.
- Add fixture tests for parser, config, and pre-runtime failures in future CLI templates.

## Decision 18: Require Run Correlation For Agent-Facing Machine Surfaces

```yaml
id: agent-cli-evaluation-018
status: accepted
decided_at: "2026-06-11"
decision: Require run correlation for agent-facing machine output, event streams, diagnostics, and persisted support artifacts
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-cli-seam-contract.md
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - skills/cli-author/references/agent-native-cli-design.md
  - "2026-06-11 Codex session: CLI seam contract grilling"
decision_mode:
  question: When should run correlation be mandatory?
  option: Mandatory for agent-facing machine output, event streams, diagnostics, and persisted support artifacts.
  confidence: strong
```

Decision:

- Require run correlation for agent-facing machine output.
- Require run correlation for event streams, diagnostic surfaces, and persisted support artifacts.
- Do not require run correlation for every tiny human-only CLI invocation.
- Keep exact identifier names, propagation rules, storage behavior, and redaction policy in implementation contracts after `cli-author`.

Rationale:

- Agents need a stable way to connect command output, failures, event streams, diagnostics, and support artifacts.
- Run correlation improves recovery and review without forcing observability ceremony onto tiny human-only commands.
- Persisted support artifacts become harder to use safely when they cannot be tied back to a specific run.

Consequences:

- Future agent-facing machine surfaces need a correlation owner before implementation.
- Event streams should include the correlation id at initialization or the first parseable event.
- Diagnostics pointers should preserve correlation without leaking sensitive local context.
- Human-only helpers can avoid correlation until they expose machine output, streams, diagnostics, or persisted artifacts.

Next:

- Apply this requirement during `cli-author` planning for agent-facing machine surfaces.
- Keep exact correlation contracts in code, generated docs, CLI help, or checks.

V2 Ideas:

- Standardize correlation field names after multiple implementations prove stable usage.
- Add redaction checks for correlation-linked diagnostics once support artifacts stabilize.

## Decision 19: Implement record-decision execute mode only after the dry-run seam is proven

```yaml
id: agent-cli-evaluation-019
status: accepted
decided_at: "2026-06-11"
decision: "Implement record-decision execute mode only after the dry-run seam is proven"
owner: "agent-cli-evaluation"
source:
  - "docs/brainstorms/2026-06-07-record-decision-v2-requirements.md"
  - "2026-06-11 Codex session: record-decision execute-mode follow-up"
```

Decision:

- Implement `record-decision --execute` as the guarded write path after dry-run planning works.
- Keep dry-run planning as the default command behavior.
- Require `--execute --json` before mutating a decision log.

Rationale:

The dry-run proof slice already demonstrates discovery metadata, facade envelopes, parser repair, and no-write mutation plans.
Execute mode should reuse the same plan data so the write path cannot invent a different target, decision identity, or validation story.
The research-backed CLI seam decisions require explicit execute intent before local file mutation.

Consequences:

Agents can preview a decision append before writing it.
Execute writes become possible without weakening the dry-run default.
Future write failures need structured mutation safety data.

Next:

Implement guarded execute mode with atomic target replacement and tests proving dry-run and execute stay aligned.

V2 Ideas:

- Add same-log supersession after the simple append path is proven.
- Add duplicate-decision detection after the checker exists.

## Decision 20: Govern Write-Preview-Plus-Execute CLI Adoption

```yaml
id: agent-cli-evaluation-020
status: accepted
decided_at: "2026-06-11"
decision: "Govern write-preview-plus-execute CLI adoption"
owner: "agent-cli-evaluation"
source:
  - "docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md"
  - "skills/cli-author/SKILL.md"
  - "skills/cli-author/references/agent-native-cli-design.md"
  - "runtime/cli-command-facade/CONTEXT.md"
  - "2026-06-11 Codex session: record-decision governance follow-up"
```

Decision:

- Govern the write-preview-plus-execute pattern through `cli-author` planning guidance.
- Treat `cli-author` as the adoption owner for deciding when a CLI needs dry-run preview, explicit execute intent, discovery metadata, structured failures, and drift proof.
- Treat `runtime/cli-command-facade` as the shared owner for generic contract projection, discovery output, error envelopes, and reusable alignment checks.
- Treat each CLI package as the owner for domain-specific runtime semantics, mutation safety, fixtures, and end-to-end dry-run/execute parity tests.
- Do not make every CLI support `--execute`; require explicit execute intent for local mutation surfaces where a dry-run preview exists.

Rationale:

- Governance belongs at decision and planning seams before implementation starts.
- Facade-level law should cover reusable mechanics, not domain-specific write semantics.
- Package-level tests are the only place that can prove the command writes the exact operation it previewed.
- Over-standardizing field names or taxonomies now would freeze early vocabulary before multiple CLIs prove it.

Consequences:

- New or changed agent-facing CLIs use `cli-author` to route the contract path.
- Create-cli guidance needs to name this pattern explicitly for mutation-capable CLIs.
- Facade improvements should focus on generic drift proof surfaces that many CLIs can reuse.
- Record-decision remains the first proving implementation, not the template for every CLI.

Next:

- Update `skills/cli-author` guidance so future CLI work routes mutation-capable surfaces through this pattern.
- Consider facade-level alignment helpers only after another CLI needs the same proof.

V2 Ideas:

- Promote a reusable write-preview contract after two or more CLIs converge on stable semantics.
- Add template fixtures for dry-run/execute parity once the pattern recurs.
- Standardize execution intent flag names only if multiple CLIs need cross-command consistency.

## Decision 21: Adopt conditional CLI Front Door topology

```yaml
id: agent-cli-evaluation-021
status: accepted
decided_at: "2026-06-11"
decision: "Adopt conditional CLI Front Door topology"
owner: "agent-cli-evaluation"
source:
  - "docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md"
  - "docs/research/2026-06-11-agent-cli-seam-contract.md"
  - "docs/research/2026-06-11-agent-cli-evaluation-rubric.md"
  - "skills/create-skill/references/runtime-portability.md"
  - "skills/cli-execution-auditor/src/audit-engine.ts"
  - "scripts/check-workspace-facade-invariants.ts"
  - "2026-06-11 Codex session: ICA seam swarm on CLI Front Door topology"
```

Decision:

- Adopt `CLI Front Door` as the qualified term for a package-owned public CLI Interface seam.
- Use `src/front-doors/<cli-name>/` only when a package has multiple CLI front doors or one CLI front door grows enough adapter files to need an owner folder.
- Keep simple single-CLI packages flat unless the deletion test shows the flat shape hides ownership.
- Keep one package-root `package.json` by default.
- Add nested `package.json` files only for independent distribution, dependency, or runtime ownership.
- Keep package-level `src/command-contract.ts` valid when command vocabulary, result literals, actions, or facade contract fragments are shared across CLI front doors.
- Allow front-door-local `command-contract.ts` only when that front door owns distinct public Interface vocabulary.
- Treat one-level CLI shape as a strong default, not an invariant.
- Require a Command Contract Locator seam before mechanically enforcing front-door-local contract discovery.
- Keep consumer folder topology outside the `runtime/cli-command-facade` ownership surface.

Rationale:

- The ICA seam swarm found the topology conditionally tight for multi-CLI or complex packages.
- Existing portability guidance and checks still assume `src/<command-name>.ts` and package-level `src/command-contract.ts`.
- `cli-execution-auditor` and workspace facade checks currently resolve only the package-level contract path.
- Per-front-door contracts can reduce Locality when a package has shared command vocabulary.
- The qualified term avoids reopening the historical skill-role `front-door` confusion.

Consequences:

- `cli-author` remains the design owner for deciding when a CLI front-door folder is warranted.
- `create-skill` runtime portability guidance needs to stop treating flat `src/<command-name>.ts` as the only multi-command package shape.
- Tooling must learn package-level and front-door-local contract locations before front-door contract placement becomes enforceable.
- `record-decision` stays flat until it grows another CLI front door or a complex public Interface seam.
- Existing multi-CLI packages should not migrate wholesale before shared package vocabulary and contract location are separated.

Next:

- Design the smallest Command Contract Locator that lets auditors and workspace checks find package-level and front-door-local command contracts.
- Update `cli-author` and runtime portability guidance after the locator decision.
- Resolve the durable vocabulary owner for `CLI Front Door`.

V2 Ideas:

- Add an import-direction check after the first front-door migration proves the shape.
- Add a topology check for package scripts, bins, front doors, contracts, and tests after locator support exists.
- Prove the folder shape on a low-noise package before migrating a large package such as `browser-use`.

## Decision 22: Use Conventional Command Contract Locator Discovery

```yaml
id: agent-cli-evaluation-022
status: accepted
decided_at: "2026-06-11"
decision: "Use conventional Command Contract Locator discovery"
owner: "agent-cli-evaluation"
source:
  - "docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md"
  - "skills/cli-execution-auditor/src/audit-engine.ts"
  - "scripts/check-workspace-facade-invariants.ts"
  - "2026-06-11 Codex session: Command Contract Locator implementation"
```

Decision:

- Use a tooling-owned conventional Command Contract Locator.
- Discover package-level contracts at `src/command-contract.ts`.
- Discover CLI Front Door contracts at `src/front-doors/*/command-contract.ts`.
- Keep package-level contracts first, then sort CLI Front Door contracts.
- Merge discovered contract maps for audit.
- Fail acquisition when two discovered contracts define the same command name.
- Resolve surface audit runnables from each command's own `script` value.
- Do not add package manifest metadata for this slice.
- Do not make `runtime/cli-command-facade` own consuming package folder topology.

Rationale:

- Existing packages already use the package-level contract convention.
- CLI Front Door contracts need mechanical discovery before placement can be enforced.
- Conventional discovery is enough for the two accepted locations.
- Manifest metadata would add package churn before a real package needs non-conventional layout.
- The facade runtime owns reusable grammar, not consumer topology.

Consequences:

- `cli-execution-auditor` can audit package-level and CLI Front Door contracts.
- `scripts/check-workspace-facade-invariants.ts` can validate script references in both contract locations.
- Packages may stay flat when command vocabulary is shared.
- Packages may put front-door-local contracts under `src/front-doors/<cli-name>/` when vocabulary is distinct.
- Duplicate command names across discovered contract files are treated as acquisition failure.

Next:

- Update `cli-author` and runtime portability guidance to name both contract locations.
- Keep `CLI Front Door` and `Command Contract Locator` vocabulary in root `CONTEXT.md`.
- Add import-direction checks only after a real front-door migration proves the shape.

Future Ideas:

- Add explicit manifest metadata only if a package needs non-conventional contract locations.
- Add a topology check for bins, package scripts, front-door folders, and contract owners.
