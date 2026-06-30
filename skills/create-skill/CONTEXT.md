# Create Skill Context

Scoped vocabulary for portable skill authoring, skill cleanup, capability ownership, and agent-native helper handoff.

This context owns reusable skill-creation language. Repo-specific domains keep their own nearest `CONTEXT.md`.

## Preview Index

- Read `Skill Design` for routing, invocation, roles, portability, and context-storage terms.
- Read `Capability Ownership` before deciding which artifact owns a contract.
- Read `Agent-Native Helpers` before naming runtime-backed helper surfaces.

## Skill Design

**Skill routing**:
Model-side selection of a skill from name, description, request shape, and loaded context.
_Avoid_: invocation, execution, guaranteed activation, deterministic route

**Skill invocation**:
The runtime, user, or driver mechanism that makes a routed skill run.
_Avoid_: routing, discovery, description matching, model selection

**Manual fallback**:
An explicit callable route for a skill when automatic routing is not reliable enough.
_Avoid_: better description only, hidden fallback, guaranteed auto-trigger

**Skill driver**:
The human, plan, or agent that invokes a skill and supplies its working context.
_Avoid_: caller, agent-only mode, separate skill

**Routing evidence**:
Model-readable signal that helps skill routing without guaranteeing skill invocation.
_Avoid_: routing contract, deterministic activation, guaranteed match, prose contract

**Owner path**:
The authoritative file, command, script, doc, or runtime surface that owns a rule or contract.
_Avoid_: copied contract, prose duplicate, hidden owner

**Skill collision**:
Two or more skills competing for the same request shape.
_Avoid_: normal overlap, driver gap, routing contract failure

**Skill bridge**:
A temporary route used only when active route evidence proves a rename would break startup, an active skill, script, exported bundle, known external doc, or current user invocation.
_Avoid_: legacy wrapper, permanent duplicate, hidden alias, second owner

**Entry-screen route clarity**:
The first-screen skill shape that maps request shapes to owner paths, references, scripts, templates, and next safe actions.
_Avoid_: skill runbook, self-contained handbook, hidden reference tree, exhaustive catalog, workflow router

**Task family**:
A repeated request shape or workflow a skill is meant to handle.
_Avoid_: one-off prompt, implementation unit, user story, broad domain

**Overloaded actor**:
The user, agent, runtime, maintainer, or reviewer carrying avoidable work because the skill shape is wrong.
_Avoid_: vague stakeholder, blame target, ceremonial persona

**False-success scenario**:
A ship-but-fail case where the skill appears complete but fails its route, safety, owner, output, or verification job.
_Avoid_: generic risk, exhaustive test plan, worst imaginable failure

**Skill design decision runbook**:
Reference owner that helps choose the smallest skill shape, invocation mode, owner path, safety gate, and next safe action.
_Avoid_: second workflow owner, vague philosophy doc, required heading schema

**Heading Selection Matrix**:
Advisory matrix that helps choose `SKILL.md` body headings from use case and selection strength; not a body-heading contract.
_Avoid_: required heading schema, role heading template, body-heading contract

**Skill role**:
The primary job label for a skill: main-entry, advisor, tool-workflow, support-reference, control-plane, quality-gate, or bridge.
_Avoid_: lifecycle status, risk tier, freeform category, multi-role taxonomy

**Skill ability**:
A small named extra behavior a skill may perform without changing its primary role.
_Avoid_: second role, hidden side effect, role soup

**Portable skill bundle**:
A skill bundle whose reusable workflow guidance avoids hidden repo-specific paths, local machine facts, personal assumptions, and harness-only contracts unless those limits are named.
_Avoid_: universal contract, copied repo policy, local-only skill, unstated harness dependency

**Runtime portability**:
The rule set for moving skill scripts and helper commands across machines by naming runtime, owner files, package metadata, lockfiles, verification path, and missing-dependency state.
_Avoid_: Bun-only policy, hidden local tool, script portability by assumption, universal claim

**Local development portability**:
A runtime-backed skill state where the skill works in this repo because a named local owner exists, but does not travel alone without that owner.
_Avoid_: universal portability, hidden local path, non-portable by surprise

**Shared portable runtime owner**:
A reusable runtime package that travels with a portable export payload so multiple skills can depend on one bundled implementation instead of copying helper code into each skill.
_Avoid_: per-skill copy, hidden local checkout, private package assumed universal

**Skill setup context**:
User-specific or environment-specific context a skill needs to operate.
_Avoid_: workflow prose, hidden contract, second skill body

**Context storage routing**:
Owner-first choice of storage bucket for durable context that survives the current turn.
_Avoid_: default store, storage catalog, case-by-case guess

**Storage routing map**:
The reference owner that defines context placement decision order, required facts, store categories, safety gates, and next safe actions.
_Avoid_: advisor skill, runtime store, content manager, legacy storage framework

**Context advisor**:
The advisor skill that recommends where durable context belongs by naming owner path, storage bucket, safety gate, rejected nearby buckets, and next safe action.
_Avoid_: context manager, legacy storage framework, capture workflow, storage runtime, content owner

**Context placement advice**:
The non-mutating output of a context advisor: recommendation, assumptions, safety stance, truth stance, rejected stores, and next action.
_Avoid_: storage write, migration, capture workflow, content management

**Project tracker**:
Scoped durable work-state owner for progress, open questions, queues, audits, blockers, and next actions.
In this repo, the owner path is `skills/coding-task-tracker/SKILL.md`.
_Avoid_: decision log, rulebook, domain glossary, source of accepted truth, default `TASKS.md`

**Accepted reusable rule**:
A user-approved skill-authoring rule that has landed in its owner path.
_Avoid_: chat-only agreement, tracker note, open question, proposed rule

**Validated reusable rule**:
An accepted reusable rule whose owner path changed, whose relevant checks passed, and whose change improves the task family against the skill quality bar.
_Avoid_: plausible improvement, untested proposal, chat-approved idea, snippet-derived rule

**Skill refinement**:
The evidence-driven process of improving a skill by routing refinement evidence into proposed owner-path changes, then accepting only validated reusable rules.
_Avoid_: self-improving AI, auto-update, autonomous mutation, prompt tweaking

**Skill quality bar**:
The task-family-specific standard used to decide whether a skill refinement improves the skill without adding avoidable carrying cost.
_Avoid_: generic quality, vibes, preference, universal rubric, prose polish

**ADHD-friendly DX**:
Low-load skill interaction pattern that uses short numbered choices, one recommended default, visible momentum, and owner-named next safe actions.
_Avoid_: exhaustive menu, vague empathy note, hidden recommendation, style-only preference

**Run Card**:
A compact workflow scaffold for complex skills that names scope, defaults, first safe action, visible state, verification, fallback, and expected final shape.
_Avoid_: mandatory checklist, body-heading schema, exhaustive runbook, hidden process

**Refinement evidence**:
A source signal used to decide whether skill refinement is warranted: observed failure, review finding, adversarial probe, or research.
_Avoid_: hunch, theoretical risk, preference, context-free best practice

**Observed failure**:
A real skill miss seen during actual use.
_Avoid_: review finding, adversarial probe, hypothetical hole, theoretical risk

**Skill gotcha**:
A compact skill-local correction for a repeatable, non-obvious agent failure.
_Avoid_: generic tip, theoretical risk, broad best practice, copied research summary, full workflow prose

**Gotcha decision**:
The required create, review, or heal outcome that records whether refinement evidence produced no gotcha, an inline gotcha, reused existing guidance, or a safety gate.
_Avoid_: optional note, hidden consideration, mandatory empty Gotchas section

**Skill Doctor**:
A targeted quality-gate helper that produces a Skill Health Report for one selected skill target or review artifact.
_Avoid_: auto-healer, portfolio dashboard, periodic audit, broad repo sweep

**Skill self-audit loop**:
A stateful audit loop for one target `SKILL.md` where fresh passes add only new accepted contradictions to an audit loop file and stop when a pass adds none. It records evidence and repair candidates; it is not source repair or generic reviewer convergence.
_Avoid_: mvp-loop-maker, generic reviewer loop, auto repair, Skill Doctor

**Audit loop file**:
A committed repo-relative markdown state file at `docs/skill-audits/<skill-directory-name>/self-audit-loop.md` that carries the target skill, loaded owner paths, findings ledger, stop rule, repair handoff, and next safe action for a later `/goal` or `/loop` run. It is evidence and driver state, not canonical skill instruction or skill-local runbook material.
_Avoid_: canonical instruction, source patch, transcript archive, reviewer ledger, skill-local docs

**Skill contradiction**:
A supported conflict between two skill instruction sources where both cannot be followed at the same time. Common forms are authority conflict, scope conflict, lifecycle conflict, and safety conflict.
_Avoid_: style issue, vague wording, missing example, preference, general improvement

**Skill Health Report**:
A structured quality-gate result that separates target status, findings, repair hints, rerun evidence, and blocked or degraded handoff.
_Avoid_: scorecard, generic review notes, auto-fix plan, reusable-rule approval

## Capability Ownership

**Capability**:
A registry-managed skill or agent, together with the files owned by that skill or agent.
_Avoid_: imported thing, tool, plugin, runbook capability

**Source**:
The provenance record for where a capability came from.
_Avoid_: install unit, upstream capability, source capability

**Skill provenance**:
Source-history record for imported, copied, adapted, or lineage-heavy skills.
_Avoid_: glossary, live workflow, context owner, decision log

**Snapshot**:
The preserved upstream copy of a selected capability at a pinned source version.
_Avoid_: fork, canonical copy, installed copy

**Canonical capability**:
The local adapted copy of a capability and the source used for installation.
_Avoid_: snapshot, fork, installed output, local patch

**Overlay**:
The smallest harness-specific difference needed when installing a canonical capability.
_Avoid_: fork, duplicate capability, harness copy

**Discovery projection**:
A harness-visible exposure of a canonical capability, usually by symlink, copy, or generated artifact.
_Avoid_: duplicate capability, second source of truth, copied workflow

**Capability dependency**:
A manually declared skill or agent that a capability needs to work.
_Avoid_: auto dependency, inferred dependency, implicit dependency

**Hard dependency**:
A required owner path, skill, command, config, or data source that blocks the workflow when missing.
_Avoid_: best-effort fallback, hidden dependency, degraded mode

**Optional handoff**:
A skill-to-skill transfer that may be used when available, with a named fallback owner path when unavailable.
_Avoid_: hard dependency, silent skip, copied fallback

**Owner-reference fallback**:
A readable owner path used when an optional skill handoff is unavailable; contains rules, maps, safety gates, examples, and next safe action, not a duplicate workflow.
_Avoid_: hard dependency, hidden dependency, copied workflow

**Bundled reference**:
A reference file shipped inside the same skill folder so the skill carries its own deep notes when moved.
_Avoid_: repo-scattered reference, copied owner, hidden portable dependency

**Blocked state**:
A stop condition when a missing dependency, unsafe ambiguity, or unavailable owner would make the workflow unsafe or fake.
_Avoid_: degraded state, silent skip, improvised fallback

**Degraded state**:
A partial-work condition where the safe core workflow can continue while a non-essential feature is unavailable.
_Avoid_: blocked state, fake success, hidden missing dependency

**Dependency label**:
An explicit dependency type on a referenced skill, owner path, command, config, or data source.
_Avoid_: unlabeled dependency, hidden owner, assumed availability

**Capability risk flag**:
A composable review signal attached to a capability, such as secrets, writes, network use, or side effects.
_Avoid_: risk tier, risk level, lifecycle status

**Install target**:
A harness surface that may receive an installed capability.
_Avoid_: source, snapshot destination, install unit

**Alias wrapper**:
A thin redirect from an alternate capability name to the canonical capability name.
_Avoid_: duplicate copy, second canonical capability, forked alias

## Agent-Native Helpers

**Contract runtime**:
A runtime component that validates and enforces a declared contract.
_Avoid_: power tool, implementation guide, docs-owned schema, prose contract

**Runtime-backed capability**:
An agent-native CLI behavior already exposed or enforced by the contract runtime.
_Avoid_: future contract, aspirational contract, rubric-owned contract, prose contract

**Contract candidate**:
An agreed agent-native CLI behavior that may belong in the contract runtime later but is not yet runtime-backed.
_Avoid_: contract-owned, runtime-backed, required field, schema promise

**Minimum CLI design brief**:
The prose-level starting brief captured before choosing basic, agent-native, or facade-backed CLI depth.
_Avoid_: universal minimum CLI contract, minimum CLI contract, prose contract

**Minimum agent-native CLI bar**:
The smallest behavior set a skill driver can safely rely on before deeper CLI contract design.
_Avoid_: full adoption checklist, maturity model, every rubric item, implementation plan

**Agent-native CLI design layer**:
The judgment layer that applies the CLI baseline to skill-driver workflows.
_Avoid_: overlay, rubric, contract runtime, agent-only skill

**Runner Facade**:
A thin runtime wrapper that normalizes one tool invocation into discoverable, parseable, repairable agent evidence.
_Avoid_: workflow engine, workflow facade, raw tool passthrough, skill prose contract

**Workflow Facade**:
A runtime owner for multi-step workflow orchestration, route policy, state transitions, and repair loops.
_Avoid_: runner facade, bigger runner, prose workflow, premature orchestrator
