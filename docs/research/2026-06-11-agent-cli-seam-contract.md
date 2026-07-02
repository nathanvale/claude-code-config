---
title: Agent CLI Seam Contract
date: "2026-06-11"
timezone: Australia/Melbourne
status: draft
source:
  - docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - docs/research/2026-06-11-playwright-cli-rubric-evaluation.md
  - docs/research/2026-06-11-agent-browser-cli-rubric-evaluation.md
  - docs/research/2026-06-11-codex-cli-rubric-evaluation.md
  - docs/research/2026-06-11-gemini-cli-rubric-evaluation.md
  - docs/research/2026-06-11-aider-cli-rubric-evaluation.md
  - docs/research/2026-06-11-claude-tap-cli-rubric-evaluation.md
  - docs/research/2026-06-02-agent-native-cli-best-practices-research.md
  - skills/cli-author/references/cli-guidelines.md
  - skills/cli-author/references/agent-native-cli-design.md
  - context/code-style.md
  - https://www.domainlanguage.com/ddd/reference/
  - https://teamtopologies.com/key-concepts-content/team-interaction-modeling-with-team-topologies
  - https://teamtopologies.com/resources
  - https://clig.dev/
  - https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap12.html
  - https://www.gnu.org/prep/standards/standards.html
---

# Agent CLI Seam Contract

Use this contract before implementing new agent-native CLI patterns.

## Purpose

- Define architectural seams for agent-facing CLIs.
- Give future agents a map from command behavior to owning files.
- Make command contracts inspectable, testable, and repairable.
- Keep Playwright as one reference, not the default answer.
- Compare CLI evidence with DDD, Team Topologies, and ICA-style seam thinking.

## Non-Goals

- Do not define exact JSON schemas in this doc.
- Do not require `@side-quest/cli-command-facade` for every CLI.
- Do not create a parallel agent-only CLI workflow.
- Do not record new accepted decisions here.
- Do not make folder names substitute for runtime checks.

## Evidence Base

- Playwright:
  - Strong thin-wrapper and hidden-protocol architecture.
  - Weak public agent contract.
  - Useful registry seam through `install --dry-run` and `install --list`.
- Agent Browser:
  - Strong agent-facing discovery, skills, doctor, observability, and output budget controls.
  - Gaps in parser/config JSON coverage and run correlation.
- Codex:
  - Strong protocol, doctor, plugin, MCP, schema, and event-stream seams.
  - Gaps in top-level command discovery and uniform failure envelopes.
- Gemini:
  - Strong `json`, `stream-json`, ACP, session, and trust-gate seams.
  - Machine output is not command-tree-wide.
- Aider:
  - Mature human CLI, script flags, parser-derived completions, and clear source ownership.
  - Discovery and smoke paths can mutate state unless carefully gated.
- claude-tap:
  - Strong trace capture, SQLite store, export, viewer, and support matrix seams.
  - Missing bounded machine-readable session and capability discovery.
- DDD:
  - Bounded context defines where a model applies.
  - Ubiquitous language keeps code, docs, and team speech aligned.
  - Modules should tell the story of the system.
  - Context maps name contacts, translations, shared kernels, and upstream/downstream relationships.
- Team Topologies:
  - X-as-a-Service works after collaboration discovers suitable seams.
  - X-as-a-Service lowers cognitive load only when ownership, developer experience, and product thinking are clear.
  - Team APIs make ownership and interaction expectations explicit.
  - Thinnest Viable Platform warns against building more platform than the consuming teams need.
- CLI baseline:
  - stdout carries primary data.
  - stderr carries diagnostics.
  - `--help`, `--version`, long options, real parsers, stable output modes, `--no-input`, and non-interactive behavior are interface contract material.
- ICA vocabulary:
  - A Module has one Interface.
  - An Interface includes invariants, ordering, error modes, configuration, and performance.
  - A Seam is where an Interface lives.
  - Tests cross the same Interface as callers.

## Adopted Principles

- Start from ownership surfaces.
- Let file and folder structure project ownership.
- Keep executable wrappers boring.
- Expose machine seams as public agent contracts.
- Keep command files thin.
- Keep runtime side effects out of parser glue.
- Make discovery and registry first-class seams.
- Keep discovery and smoke paths read-only by default.
- Cover parser, config, auth, trust, dependency, and pre-runtime failures in machine output.
- Use `doctor --json` for readiness and diagnostics.
- Use explicit repair commands or flags for mutation.
- Treat observability as product surface, not debug leftovers.
- Keep generated artifacts under a generated owner and name their source.
- Keep exact contracts in code, generated docs, CLI help, or checks.
- Keep prose contract documents as maps, not schema owners.

## Ownership Surfaces

Use these owners before choosing folders.

### Wrapper

- Own executable lookup, argv forwarding, exit-code forwarding, signal forwarding, and minimal provenance env.
- Reject parser logic, business policy, runtime mutation, and command help.
- Test delegation, missing-runtime failure, and exit-code preservation.

### CLI

- Own argv parsing, top-level routing, help rendering, stdout/stderr routing, TTY behavior, color, pagination, and global flags.
- Wrap unexpected runtime failures into the public failure contract.
- Treat parser glue as part of the agent contract.

### Command Contract

- Own command ids, command purpose, args, flags, output modes, side-effect stance, examples, owner hints, action ids, and validation rules.
- Feed rendered help, parser acceptance, discovery metadata, and alignment checks from one source where practical.
- Keep exact field names in runtime code and tests.

### Command Handlers

- Own command-level orchestration after parse.
- Call engine, discovery, protocol, runtime, and observability owners.
- Avoid hidden parsing, hidden rendering, and direct process exits.

### Model

- Own shared runtime types, package vocabulary, stable result literals, and exported data shapes.
- Keep vocabulary close to `CONTEXT.md` terms.
- Avoid leaking command-specific renderer concerns into shared model objects.

### Engine

- Own pure policy, ranking, evaluation, planning, state transitions, and deterministic decisions.
- Avoid filesystem, network, auth, browser, shell, or process side effects.
- Test through the smallest public Interface that gives leverage.

### Discovery

- Own capability state, installed state, config provenance, cache ownership, freshness, version compatibility, and planned mutation previews.
- Keep default discovery read-only.
- Emit bounded parseable output.

### Runtime

- Own filesystem, network, auth, browser, package-manager, git, analytics, and externally visible effects.
- Require explicit execute intent for high-risk mutation.
- Report what changed.

### Protocol

- Own stdio, WebSocket, MCP, ACP, app-server, SDK, generated schema, and event-stream transports.
- Expose public protocol modes when agents are intended users.
- Keep hidden protocol seams hidden only for explicit product reasons.

### Observability

- Own run correlation, trace ids, diagnostics pointers, event streams, log paths, redaction, output budgets, quiet/verbose/debug behavior, and persisted support artifacts.
- Prefer diagnostic pointers over large log dumps.
- Redact secrets, account identifiers, profile names, local paths, and debugger URLs unless the privacy posture allows them.

### Generated

- Own generated schemas, generated docs, generated bindings, and generated command catalogs.
- Name the source generator in each generated file.
- Validate freshness with checks.

### Docs And Skills

- Own workflow guidance, examples, and next safe actions.
- Link to runtime owners for deterministic behavior.
- Avoid copying schemas, flags, parser rules, state machines, or output semantics.

## Proposed File And Folder Contract

Use this tree as a default for non-trivial agent-native CLIs.

```text
src/
  cli/
    main.ts
    parse.ts
    render.ts
    errors.ts
    commands/
  contract/
    command-catalog.ts
    command-discovery.ts
    output-modes.ts
    side-effects.ts
  model/
  engine/
  discovery/
  runtime/
  protocol/
  observability/
  generated/
tests/
  cli/
  contract/
  discovery/
  runtime/
  protocol/
  fixtures/
docs/
  research/
  decisions/
```

Use different names when the repo already has stronger owner terms.

## Naming Guidance

- Use lowercase `kebab-case` file names.
- Name folders after ownership surfaces, not implementation technologies.
- Name command files after stable command ids.
- Use `*-handler.ts` for command handlers when command files would otherwise mix parse, orchestration, and rendering.
- Use `*-contract.ts` for contract-owned metadata and validators.
- Use `*-renderer.ts` only when human rendering is separate from machine output.
- Use `*-schema.ts` only for runtime-owned schema definitions.
- Use `*.generated.*` or a generated folder for generated artifacts.
- Name tests after the public Interface they exercise.
- Avoid `utils`, `helpers`, `common`, and `misc` unless the repo already has a tight owner definition for them.
- Prefer domain and contract nouns over framework nouns.

## Command Contract Guidance

- Provide `discover --json` or equivalent when command trees exceed a few commands.
- Include command ids, args, flags, output modes, side-effect stance, examples, owner hints, and repair action ids.
- Generate help and discovery metadata from the same command source where practical.
- Add an alignment proof when parser, rendered help, discovery metadata, and runtime semantics can drift.
- Support `-h`, `--help`, and `--version`.
- Print primary data to stdout.
- Print diagnostics to stderr.
- Provide `--json` for stable machine output when agents or scripts consume results.
- Provide `--plain` for stable line-oriented output when useful.
- Use `--no-input` to fail instead of prompting.
- Use `--dry-run` or preview commands for planned mutations.
- Use `--force` or explicit confirmation tokens only for deliberate non-interactive execution.
- Do not accept secrets directly as flag values.

## Protocol Guidance

- Treat protocol modes as separate seams from human commands.
- Expose protocol schema generation through a CLI command when schemas are public.
- Keep SDKs and generated bindings under protocol or generated owners.
- Keep event streams parseable without scraping human text.
- Include session ids or run ids in stream init events.
- Make hidden protocol commands discoverable only when they are supportable public contracts.

## Discovery Guidance

- Make `doctor --json` read-mostly by default.
- Split `doctor --fix` or equivalent mutating repair from diagnostic reporting.
- Provide safe smoke commands that avoid auth, onboarding, git mutation, update checks, analytics writes, and long waits.
- Include installed state, capability state, cache paths, owners, versions, freshness, source URLs, and planned side effects when relevant.
- Redact or gate local paths and account/profile names in machine discovery.
- Provide bounded listing for stored sessions, traces, plugins, MCP servers, skills, registries, and caches when the CLI owns them.

## Recovery Guidance

- Every structured failure answers:
  - What happened.
  - What changed.
  - Whether same-input retry is safe.
  - What the next safe action is.
  - Where diagnostics can be found.
- Separate usage, config, auth, trust, dependency, external service, runtime, interrupted, and missing-capability failures.
- Register known unavailable commands as missing-capability stubs when the command name is predictable.
- Keep destructive, auth, billing, externally visible, and irreversible repairs behind human handoff or explicit execute mode.
- Do not let confidence override side-effect, reversibility, idempotency, auth, or confirmation gates.

## Observability Guidance

- Add run correlation to structured success and failure paths.
- Use quiet success and rich failure.
- Preserve structured failure output under `--json` even before runtime starts.
- Provide output budget controls for token-heavy surfaces.
- Point to persisted diagnostics when full detail would flood context.
- Respect `NO_COLOR`, `TERM=dumb`, non-TTY stdout, and `--no-color` when color exists.
- Handle Ctrl-C with fast exit and bounded cleanup.

## Test And Drift Checks

- Wrapper:
  - Prove argv forwarding.
  - Prove exit-code and signal preservation.
  - Prove missing-runtime repair text.
- Parser:
  - Prove `--help`, `--version`, unknown command, missing arg, invalid flag, and flag dependency behavior.
  - Prove `--json` covers parser and config failures.
- Command contract:
  - Prove discovery metadata renders.
  - Prove help and discovery use the same command source or fail an alignment check.
  - Prove each command declares side-effect stance and output modes.
- Discovery:
  - Prove default discovery and smoke paths are read-only.
  - Prove mutation preview lists planned side effects.
- Recovery:
  - Prove structured failures include category, retry safety, changed state, diagnostics pointer, and next safe action.
  - Prove known missing capabilities return missing-capability guidance.
- Protocol:
  - Prove schema generation and generated bindings are fresh.
  - Prove event streams are parseable and include correlation.
- Observability:
  - Prove redaction.
  - Prove output budget controls.
  - Prove diagnostics pointers exist for rich failures.

## Adoption Sequence

- Start with `cli-author`.
- Classify the lane before implementation.
- Name contract, model, engine, discovery, CLI, runtime, protocol, observability, generated, docs, and test owners.
- Pick one vertical slice.
- Implement parser, help, discovery metadata, runtime behavior, machine output, and tests for that slice.
- Run the alignment proof before adding more commands.
- Add protocol, doctor, repair, and observability recipes only when the workflow earns them.

## Open Questions

- Should the default folder be `contract/` or `command-contract/` for new repos?
- Should the standard discovery command be `discover --json`, `commands --json`, or `help --json`?
- Which owner defines cross-CLI recovery categories and action ids?
- Which local paths are safe in machine output under Nathan's privacy posture?
- When should an MCP surface become required instead of optional beside the CLI?
- Should `doctor --json` share one check vocabulary across helper CLIs?

## Candidate Decisions

- Accept this contract as the default architecture map before new agent-native CLI implementation.
- Require a command-surface alignment proof for non-trivial agent CLIs.
- Standardize a read-only `doctor --json` and explicit mutating repair split.
- Standardize a command discovery metadata surface for command trees above a small threshold.
- Standardize structured failure coverage for parser, config, and pre-runtime failures.
- Standardize run correlation for agent-facing machine output.
