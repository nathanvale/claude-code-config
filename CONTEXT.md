# Claude Code Config

This context defines the durable language for the agent configuration, prompt, skill, and runbook system in this repository.

`CONTEXT-MAP.md` indexes all scoped contexts and their relationships. This root context owns cross-cutting agent-config, startup, governance, and CLI-design vocabulary only; domain clusters live in their own scoped `CONTEXT.md`.

## Language

### Agent config & startup
**Startup Surface**:
Agent instructions automatically loaded at session start. Includes rendered startup artifacts and wrappers; excludes on-demand context, skills, repo-local docs, generated references, and runtime config unless injected into startup.
_Avoid_: startup prompt, global prompt, always-loaded handbook

**Agent runtime**:
Agent tool that loads Startup Surface instructions, such as Claude Code or Codex. Use this term for concrete Claude/Codex delivery mechanics; keep Harness Engineering for the philosophy.
_Avoid_: harness, model, agent, client

**Harness Engineering**:
Agent-first engineering posture where humans design legible environments, repository knowledge, tools, and feedback loops so agents can execute reliable work. Use it as philosophy, not as a new workflow owner.
_Avoid_: prompt stuffing, agent handbook, manual coding replacement, vibe automation

**Context Engineering**:
Agent-first posture for choosing what context enters the model, when it loads, and which owner supplies it. Use it for Startup Surface routing, owner docs, retrieval paths, projections, compaction, and checks that keep context useful.
_Avoid_: prompt engineering, context dumping, bigger prompt, retrieval alone

**Context path**:
The route an agent follows from Startup Surface to the smallest sufficient owner: skill, context doc, repo doc, generated doc, runtime check, or code. It is successful when a fresh agent can find the owner without startup prose restating it.
_Avoid_: lookup flow, doc link list, table of contents only, prompt memory

**System of record**:
The durable owner for a class of instruction or knowledge. Startup may route to it, but must not duplicate its content.
_Avoid_: backup copy, duplicated policy, rendered summary, startup restatement

**Scoped ask-first gate**:
A confirmation rule for high-consequence action classes, not a blanket pause before implementation. It preserves agent autonomy for concrete requested work; low-risk ambiguity gets reasonable assumptions, high-risk ambiguity gets a question.
_Avoid_: ask before everything, implement only after confirmation, blanket confirmation

**Skill Catalog**:
Authored collection of skills that acts as the source for agent-runtime visibility.
_Avoid_: skill registry, skill source, global skills

**Skill Catalog Entry**:
Direct child skill directory identity inside a Skill Catalog, used for visibility decisions, projection state, ignore rules, and change tracking. Frontmatter describes and validates the entry; it does not replace the directory identity.
_Avoid_: frontmatter name, provider id, filesystem path

**Projection Root**:
Generated agent-runtime skill location derived from a Skill Catalog. It is not an authored source.
_Avoid_: target folder, provider root, copied skills

**Setup CLI**:
First-party owner for user runtime wiring and direct live skill projection from a selected Skill Catalog. Third-party acquisition remains with `bunx skills`.
_Avoid_: installer script, skill package manager, copied-skill deployer, retired projector

### Cross-cutting governance
**Tracker owner binding**:
The owner-path-scoped association between a durable work owner and the external task tracker that runtime-backed task commands may read or mutate. Owners may be repo roots, workspace packages, skills, or other durable owner paths.
_Avoid_: global task tracker, shared tracker, Nathan tracker, default database, repo-only tracker

**Tracker binding config**:
The split owner config that records a work owner's task-tracker identity and provider binding. Committed config owns non-sensitive owner identity; ignored local config owns account-specific Notion identifiers.
_Avoid_: tracker doc, task database default, global registry, skill setting

**Tracker owner path**:
A directory that owns task tracking because it contains a Tracker binding config. Task tracker commands resolve the nearest Tracker owner path upward from the current working directory.
_Avoid_: workspace package only, repo root only, inferred owner, global owner

**Tracker fingerprint**:
A runtime-verifiable marker on an external task tracker that proves the tracker belongs to the owner named by the Tracker binding config before CRUD commands mutate it. It uses owner identity, not local checkout paths.
_Avoid_: path check, config trust, database name match, weak warning

**Decision surface**:
The smallest stable future lookup surface a decision log belongs to. Use it for product areas, workflows, skills, implementation slices, operational areas, or long-running systems; source sessions, tags, dates, agents, and people are metadata, not owners.
_Avoid_: chat owner, tag owner, date owner, agent owner, mini ADR

**Retrospective domain modeling**:
Evidence-led recovery of project-specific language and architectural decisions from prior agent-runtime sessions, reconciled against current repository behavior. It updates domain context and ADR owners; it does not create session summaries or solution learnings.
_Avoid_: compounding, session documentation, solution store, retrospective data modeling

**Light janitor pass**:
Bounded cleanup pass that removes obvious agent-runtime and context drift: broken owner routes, stale generated outputs, appendix bloat, duplicate policy, or leftover fragments. It is not a broad documentation rewrite.
_Avoid_: governance program, documentation overhaul, content audit, policy review

**Implementation slice**:
A thin, independently verifiable unit of issue work produced during planning before Stage 3 confirmation; represented at runtime as a candidate batch.
_Avoid_: task, phase, horizontal slice, generic plan step

**MCP adoption trigger**:
A condition that moves CLI design into a separate MCP pass because clients need typed remote discovery, server-mediated auth, session transport, or MCP-native tool orchestration. It is not a reason to weaken the CLI contract.
_Avoid_: MCP by default, CLI replacement, transport-first design, generic integration idea

**CLI Front Door**:
Package-owned public CLI Interface seam. Use `src/front-doors/<cli-name>/` only when a package has multiple public CLI interfaces or one interface grows enough adapter files to need an owner folder.
_Avoid_: front-door skill role, universal CLI folder, facade-owned topology

**No-Arg CLI Front Door**:
The behavior of a public CLI when invoked without subcommands or operands. Default to help or get-started output for stateless CLIs; use a bounded dashboard only when the CLI owns meaningful current state, recent activity, health, or a work queue.
_Avoid_: CLI Front Door layout, dashboard for every CLI, report dump, personal-productivity helper

**CLI Design Lane**:
The user-facing design choice between a human-first Basic CLI and an Agent-native CLI. It answers who the interface is shaped for before any runtime enforcement choice.
_Avoid_: facade-backed lane, implementation language, runtime backend

**Facade-backed Enforcement**:
Optional runtime-backed enforcement for an Agent-native CLI when reusable facade validation is requested or an existing surface is facade-owned. It is not a separate design lane.
_Avoid_: Facade-backed CLI lane, generic runtime validation, TypeScript default, Bun default

**Command Contract Locator**:
Tooling-owned discovery seam that finds package command contracts without making the facade runtime own consumer folders. Current conventional locations are `src/command-contract.ts` and `src/front-doors/*/command-contract.ts`.
_Avoid_: package manifest by default, nested package metadata, runtime-owned consumer topology

**Command Entrypoint Integration Test**:
A process-boundary test that proves a command can be invoked through its repo-local command entrypoints while preserving the expected machine contract.
_Avoid_: smoke test, front door smoke, command surface proof

**Branch Station**:
A package-owned named command branch that represents one stable success, failure, diagnostic, repair, continuation, or observability outcome worth proving. It is the CLI analogue of a Playwright user-flow checkpoint, except the user is an agent making runtime decisions.
_Avoid_: code branch, test case, clause, route

**Branch Station Catalog**:
A package-owned catalog of Branch Stations for one CLI surface, kept beside the command contract and expressed in package vocabulary. It declares the agent-visible outcomes that tests and station maps must prove.
_Avoid_: package branch catalog, station catalog, shared branch registry

**Station Map**:
A deterministic report that reconciles command discovery, Branch Station Catalogs, and station evidence into a declared coverage view.
_Avoid_: branch coverage report, test matrix, whole-program coverage

**Declared Branch Coverage**:
The completeness claim that every declared Branch Station is covered, missing, drifted, skipped, or declared unreachable.
_Avoid_: full branch coverage, TypeScript branch coverage, all possible paths

## Example Dialogue

Dev: "Is `/ce-plan` producing implementation tasks or candidate batches?"
Domain expert: "It produces implementation slices for human planning, represented as candidate batches once the runtime parses and validates them."
