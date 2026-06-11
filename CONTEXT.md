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

**Light janitor pass**:
Bounded cleanup pass that removes obvious agent-runtime and context drift: broken owner routes, stale generated outputs, appendix bloat, duplicate policy, or leftover fragments. It is not a broad documentation rewrite.
_Avoid_: governance program, documentation overhaul, content audit, policy review

**Implementation slice**:
A thin, independently verifiable unit of issue work produced during planning before Stage 3 confirmation; represented at runtime as a candidate batch.
_Avoid_: task, phase, horizontal slice, generic plan step

**MCP adoption trigger**:
A condition that moves CLI design into a separate MCP pass because clients need typed remote discovery, server-mediated auth, session transport, or MCP-native tool orchestration. It is not a reason to weaken the CLI contract.
_Avoid_: MCP by default, CLI replacement, transport-first design, generic integration idea

## Example Dialogue

Dev: "Is `/ce-plan` producing implementation tasks or candidate batches?"
Domain expert: "It produces implementation slices for human planning, represented as candidate batches once the runtime parses and validates them."

