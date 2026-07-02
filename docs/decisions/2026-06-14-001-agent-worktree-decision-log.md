---
title: Agent Worktree Decision Log
slug: agent-worktree
type: decision-log
status: in-progress
date: "2026-06-14"
timezone: Australia/Melbourne
owner: agent-worktree
source:
  - "chat: 2026-06-14 agent-worktree decision-mode"
  - docs/brainstorms/2026-06-14-agent-native-multi-agent-cli-requirements.md
  - docs/ideation/2026-06-14-agent-native-multi-agent-cli-ideation.html
decision_metadata_format: fenced-yaml-per-decision
---

# Agent Worktree Decision Log

Use this log for accepted decisions about the repo-local `agent-worktree` package and CLI.

## Frame

- Rebuild useful SideQuest Git/worktree behavior as a new shared package in this repo.
- Treat agents as first-class CLI users.
- Make failure recovery, inspectable state, and continuation hints core product behavior.
- Keep `worktree` as the workflow entry point while moving worktree mechanics into `agent-worktree`.
- Keep exact flags, schemas, field names, exit codes, and parser contracts in code, CLI help, and tests.

## Notes

- Worktree identity is not accepted yet.
- Current recommended identity candidate: generated short ID plus display alias, lazily registered in the main-owner `.agent-worktree/` store.
- Exact package exports and full command contract remain planning-owned.
- Destructive cleanup execution is deferred beyond v1.
- Earlier doctor-first-minimal posture expanded during decision-mode into full v1 lifecycle replacement.

## Decision 1: Name The Package And CLI

```yaml
id: agent-worktree-001
status: accepted
decided_at: "2026-06-14"
decision: Name the shared package agent-worktree with agent-worktree as the canonical command
owner: agent-worktree
decision_mode:
  question: "What should the new shared package and CLI be called?"
  option: "agent-worktree package, agent-worktree command"
  confidence: strong
source:
  - "chat: 2026-06-14 agent-worktree decision-mode"
```

Decision:

- Name the package `agent-worktree`.
- Use `agent-worktree` as the canonical CLI command.
- Do not accept a separate alias yet.

Rationale:

- The name says what the package owns without tying it to the old SideQuest implementation.
- The canonical command is clear for docs, tests, and handoff.
- Alias decisions need real usage evidence before they add another supported surface.

Consequences:

- Future package, CLI, and decision references should use `agent-worktree`.
- `worktree` remains a workflow entry point, not the new package identity.
- The command contract only needs to prove the accepted canonical command behavior.

Next:

- Use `agent-worktree` when drafting the package layout and CLI contract.

V2 Ideas:

- Add extra aliases only after real command usage shows friction.

## Decision 2: Build One Shared Runtime Package

```yaml
id: agent-worktree-002
status: accepted
decided_at: "2026-06-14"
decision: Build agent-worktree as one shared runtime package at runtime/agent-worktree
owner: agent-worktree
decision_mode:
  question: "Where should the rebuilt worktree runtime live?"
  option: "One package at runtime/agent-worktree"
  confidence: strong
source:
  - "chat: 2026-06-14 agent-worktree decision-mode"
  - docs/brainstorms/2026-06-14-agent-native-multi-agent-cli-requirements.md
```

Decision:

- Build one repo-local package at `runtime/agent-worktree`.
- Keep library and CLI behavior together in that package.
- Port useful SideQuest worktree lifecycle behavior into this package instead of extending SideQuest in place.

Rationale:

- One owner reduces drift between CLI behavior and library behavior.
- A new package can be designed around agent-native contracts from the start.
- SideQuest remains source material, not the architecture boundary.

Consequences:

- Future implementation should name package, CLI, model, engine, discovery, and test owners inside `runtime/agent-worktree`.
- Existing `worktree` skill/workflow should call or route to this owner instead of owning lifecycle mechanics.
- SideQuest compatibility is selective: port useful lifecycle behavior, not historical structure by default.

Next:

- Draft the `runtime/agent-worktree` package map before implementation.

V2 Ideas:

- Split packages only if independent consumers force separate release, dependency, or ownership boundaries.

## Decision 3: Make V1 A Full Worktree Lifecycle Replacement

```yaml
id: agent-worktree-003
status: accepted
decided_at: "2026-06-14"
decision: Make v1 a full worktree lifecycle replacement with doctor as the first safety surface
owner: agent-worktree
decision_mode:
  question: "How broad should v1 be?"
  option: "Full lifecycle replacement, doctor-first"
  confidence: strong
source:
  - "chat: 2026-06-14 agent-worktree decision-mode"
  - docs/brainstorms/2026-06-14-agent-native-multi-agent-cli-requirements.md
```

Decision:

- Make v1 a full worktree lifecycle replacement.
- Include full `worktree` migration in v1.
- Port all useful SideQuest worktree lifecycle behavior in v1.
- Keep `doctor` as the first safety and routing surface.
- Include read-only `handoff` and `inspect <ref>` in v1.
- Keep `clean` preview-only in v1.

Rationale:

- A partial helper would leave agents crossing old and new recovery paths.
- Doctor-first keeps mutation behind inspectable readiness checks.
- Read-only handoff and inspect give agents recovery context without creating new side effects.
- Preview-only cleanup protects against destructive batch behavior while the state model is new.

Consequences:

- V1 planning must cover create, list, status, check, recovery, inspect, handoff, sync, and cleanup-preview workflows.
- Mutation commands must explain readiness, changed state, and next safe action.
- `clean` must not execute destructive batch cleanup in v1.

Next:

- Use `cli-author` before implementing the command contract.

V2 Ideas:

- Add executable cleanup after preview output, state tracking, and recovery semantics have been proven.

## Decision 4: Store Durable State At The Main Worktree Owner

```yaml
id: agent-worktree-004
status: accepted
decided_at: "2026-06-14"
decision: Store durable diagnostics and state in .agent-worktree at the main worktree owner root
owner: agent-worktree
decision_mode:
  question: "Where should agent-worktree durable state live?"
  option: "Main worktree owner root .agent-worktree/"
  confidence: strong
source:
  - "chat: 2026-06-14 agent-worktree decision-mode"
```

Decision:

- Store durable diagnostics and state in `.agent-worktree/`.
- Place that directory at the main worktree owner root.
- Do not place the durable store inside each linked worktree by default.

Rationale:

- Linked worktrees can be deleted as part of normal lifecycle cleanup.
- Recovery data should survive deletion of the worktree that produced it.
- A repo-level owner store gives agents one place to inspect state across runs.

Consequences:

- Discovery must resolve the main worktree owner root before reading or writing durable state.
- The store should be ignored by git unless a later decision accepts tracked artifacts.
- Commands running inside linked worktrees must route state operations back to the owner store.

Next:

- Define owner-root discovery and store layout in the package design.

V2 Ideas:

- Add exportable reports for handoff artifacts that should leave the ignored store.

## Decision 5: Use Status Plus Mutation Readiness For Doctor Routing

```yaml
id: agent-worktree-005
status: accepted
decided_at: "2026-06-14"
decision: Use ok warn blocked unknown statuses plus aggregate mutation_readiness for doctor routing
owner: agent-worktree
decision_mode:
  question: "How should doctor route agents after checks?"
  option: "Status plus mutation_readiness"
  confidence: strong
source:
  - "chat: 2026-06-14 agent-worktree decision-mode"
```

Decision:

- Use per-check `status` values: `ok`, `warn`, `blocked`, `unknown`.
- Use aggregate `status` values: `ok`, `warn`, `blocked`, `unknown`.
- Use aggregate `mutation_readiness` values: `ready`, `blocked`, `unknown`.

Rationale:

- Agents need both health state and mutation readiness.
- `unknown` keeps uncertainty explicit instead of pretending the CLI knows enough.
- `mutation_readiness` separates readiness from severity without pretending uncertainty is a boolean.

Consequences:

- Doctor output must show why mutation is allowed, blocked, or uncertain.
- Mutation commands should treat `mutation_readiness: blocked` and `mutation_readiness: unknown` as separate routing cases.
- Tests must cover status aggregation and mutation readiness drift.

Next:

- Put exact doctor output fields and aggregation rules in the command contract.

V2 Ideas:

- Add confidence or evidence fields only if recovery routing needs finer-grained uncertainty.

## Decision 6: Model Failure Recovery With Typed Refs And Changed State

```yaml
id: agent-worktree-006
status: accepted
decided_at: "2026-06-14"
decision: Model recovery around typed refs and changed_state none partial complete unknown
owner: agent-worktree
decision_mode:
  question: "How should failures be inspectable and recoverable?"
  option: "Typed refs plus changed_state vocabulary"
  confidence: strong
source:
  - "chat: 2026-06-14 agent-worktree decision-mode"
```

Decision:

- Use typed refs: `worktree:<id>`, `run:<id>`, `failure:<id>`.
- Use failure changed-state vocabulary: `none`, `partial`, `complete`, `unknown`.
- Make `inspect <ref>` the read path for refs.
- Make `handoff` a read-only snapshot in v1, not a persisted `handoff:<id>` ref namespace.

Rationale:

- Typed refs let agents pass stable handles between commands and sessions.
- Changed-state vocabulary tells agents whether retry, repair, or human handoff is safe.
- Read-only inspection avoids accidental mutation during recovery.

Consequences:

- Errors and handoffs should include refs when durable context exists.
- Recovery commands must distinguish no-change, partial-change, complete-change, and unknown-change states.
- `inspect` must be able to explain the next safe action for each supported ref type.
- `handoff` must not create durable refs unless a later decision adds a saved handoff mode.

Next:

- Define ref creation, lookup, and inspection behavior in the package model.

V2 Ideas:

- Add richer agent routing once typed refs and recovery semantics are proven in v1.
- Add saved handoff refs only if read-only snapshots prove insufficient.

## Decision 7: Preserve The Full Agent-Recoverable Repo Product Vision

```yaml
id: agent-worktree-007
status: accepted
decided_at: "2026-06-14"
decision: Preserve agent-worktree as an agent-recoverable repo product built around state maps, event trails, safety gates, merge intelligence, recovery refs, and lightweight context
owner: agent-worktree
source:
  - "chat: 2026-06-14 SideQuest product vision grill"
  - docs/brainstorms/2026-06-14-agent-native-multi-agent-cli-requirements.md
```

Decision:

- Treat `agent-worktree` as an agent-recoverable repo product, not only a worktree CRUD package.
- Keep these SideQuest-derived capabilities in the product vision: status watch, lightweight context snapshot, safety gate, merge intelligence, config sync, recovery refs, event tail, and durable event trail.
- Treat merge intelligence as a core capability that planning must not drop.
- Treat config sync, status watch, event tail, and richer context snapshots as roadmap capabilities unless the v1 plan explicitly promotes them.

Rationale:

- The product promise is that an agent can mutate a repo, fail halfway, and the next agent can inspect exactly where reality landed.
- Merge intelligence makes cleanup and deletion decisions explainable instead of guessy.
- Event trails and recovery refs make command history inspectable without transcript archaeology.
- Safety gates and lightweight context snapshots make agents safer before mutation.
- Config sync improves worktree usefulness, but it expands the side-effect surface and should be planned deliberately.

Consequences:

- Future planning must preserve state map, event trail, backup/recovery, merge intelligence, safety gate, and context snapshot lanes.
- V1 scoping may phase these lanes, but should not silently remove them from the product direction.
- Command contracts should leave room for `watch`, `events tail`, and `inspect`-driven recovery surfaces.
- SideQuest remains source material for useful mechanics, not the naming or output contract.

Next:

- During planning, split product vision into v1 core, v1 optional, and post-v1 lanes.
- Keep merge intelligence in the v1 core discussion unless an explicit later decision defers it.

V2 Ideas:

- Add a dashboard only after CLI event trails and inspectable refs are stable.
- Add richer config sync and install workflows after destructive and partial-write recovery semantics are proven.

## Decision 8: Accept V1 Lifecycle Operating Defaults

```yaml
id: agent-worktree-008
status: accepted
decided_at: "2026-06-14"
decision: Accept the v1 lifecycle defaults for retention, store layout, run identity, doctor semantics, create/delete safety, merge uncertainty, clean classification, and worktree migration order
owner: agent-worktree
decision_mode:
  question: "Which operating defaults should v1 use after the core command boundaries were accepted?"
  option: "Accept the 20 recommended defaults as a batch"
  confidence: strong
source:
  - "chat: 2026-06-14 agent-worktree grill-with-docs"
```

Decision:

- Retention: `doctor` warns on old records and refs; no automatic deletion in v1.
- Retention window: warn after 30 days.
- Cleanup command: defer deletion to a future explicit `prune`.
- Store layout: `.agent-worktree/runs/`, `.agent-worktree/failures/`, `.agent-worktree/worktrees/`.
- Event trail: append JSONL per run.
- Run identity: keep facade `run_id` plus a package-owned run record id.
- Failure identity: use `failure:<run-id>/<step-id>`.
- Doctor exit code: exit `0` when a readable map exists, even with blockers.
- Doctor blockers: report blockers in data, not process failure.
- Doctor unknown state: never permit mutation on `unknown`.
- Create base: default from current branch unless `--base` is provided.
- Create config copy: copy minimum safe config; no install by default.
- Delete branch default: remove worktree only; branch deletion requires an explicit flag.
- Delete confirmation: non-interactive destructive paths require `--force`.
- Protected branches: hard-block main, default, and protected branch patterns.
- Dirty worktree delete: block unless forced and still record dirty evidence.
- Squash merge: record separate squash evidence, not plain ancestor-merged.
- Shallow clone: mark merge evidence `unknown`.
- Clean candidates: classify registered worktrees, orphan branches, and stale directories separately.
- `worktree` migration: migrate read discovery first, then lifecycle commands.

Rationale:

- These defaults keep v1 recovery-first and avoid hidden deletion.
- Doctor remains a readable state map, not a process-failure proxy.
- Separating evidence types keeps agents from guessing across merge, cleanup, and delete workflows.
- Migrating `worktree` in read-first order preserves workspace rendering while lifecycle ownership moves.

Consequences:

- The plan should encode these as implementation constraints and acceptance examples where relevant.
- Command contracts and tests should prove destructive actions require explicit gates.
- Store and event-trail implementation should keep retention warnings inspectable without deleting state.

Next:

- Update the v1 plan with these accepted defaults.
- Add constants or tests only where they protect a scaffolded contract from drift.

V2 Ideas:

- Add `prune` only after retention warnings and recovery inspection prove useful.
- Add install/config sync behavior after create/delete recovery semantics are stable.

## Decision 9: Adopt Pressure-Earned Architecture Labels

```yaml
id: agent-worktree-009
status: accepted
decided_at: "2026-06-14"
decision: Adopt pressure-earned architecture labels for agent-worktree and reject heavier pattern names until their pressure exists
owner: agent-worktree
decision_mode:
  question: "Where should adopted and rejected architecture labels live?"
  option: "Decision log only"
  confidence: strong
source:
  - "chat: 2026-06-14 gof-pressure-lens and architecture label grilling"
  - docs/plans/2026-06-14-002-feat-agent-worktree-crud-v1-plan.md
  - docs/ideation/2026-06-14-architecture-pattern-pressure-lens-ideation.md
```

Decision:

- Adopt these labels for the current architecture: Contract-first CLI, Operation Journal, Evidence Cascade, Durable Continuation, Projection, and Runner Port.
- Keep the labels in this decision log rather than `skills/worktree/CONTEXT.md` unless they become durable domain language.
- Reject these labels for v1: Event Sourcing, Saga, CQRS, Blackboard, Strategy Registry, and full Ports-and-Adapters or Hexagonal Architecture.

Rationale:

- The adopted labels describe real pressure already present in the plan and code.
- The rejected labels add abstraction weight or imply capabilities v1 does not provide.
- The glossary already defines nearby domain terms; this decision records architecture interpretation, not new domain vocabulary.

Consequences:

- Future agents should use the adopted labels when explaining the package shape.
- Future agents should not introduce the rejected labels without a new pressure source, seam owner, deletion test, and second adapter or capability proof.
- `skills/worktree/CONTEXT.md` stays focused on workflow/domain language.

Next:

- Use the adopted labels in review, plan updates, and handoff summaries.
- Re-run the pressure gate before promoting any rejected label in v2.

## Decision 10: Accept V1 Command Shape And Output Defaults

```yaml
id: agent-worktree-010
status: accepted
decided_at: "2026-06-15"
decision: Accept the v1 command shape defaults for doctor JSON, check boundaries, identity lookup, projection, failure records, diagnostics, and adoption order
owner: agent-worktree
decision_mode:
  question: "Which command-shape defaults should v1 use after the lifecycle operating defaults were accepted?"
  option: "Accept the 20 recommended command/output defaults as a batch"
  confidence: strong
source:
  - "chat: 2026-06-15 agent-worktree batch decisions"
```

Decision:

- Doctor JSON shape: top-level `summary`, `checks[]`, `mutation_readiness`, `blockers[]`, and `next_actions[]`.
- Check aggregation: worst severity wins; `unknown` blocks mutation.
- `status` reports evidence; `check` returns a mutation verdict.
- Worktree identity: generated short id plus branch and path aliases.
- Worktree lookup: accept id, branch, or path; error on ambiguity.
- Stale directory detection: compare filesystem `.worktrees/*` with `git worktree list`.
- Protected branch source: built-ins in v1, optional local config later.
- Default protected patterns: `main`, `master`, default branch, and `release/*`.
- Config copy allowlist: copy only known safe local config files.
- Install behavior: never run install by default.
- Failure record schema: `what_happened`, `changed_state`, `changed[]`, `same_input_retry`, `next_actions`, and `diagnostics`.
- Retry semantics: `same_input_retry` values are `safe`, `unsafe`, and `unknown`.
- Recovery actions: named actions only, no embedded shell strings.
- Projection flags: `--limit`, `--fields`, and `--select`.
- JSON output: object envelopes only, never bare arrays.
- Diagnostics: stderr plus durable refs; stdout stays machine JSON.
- Unknown git evidence: preserve `unknown` with reason and command failure metadata.
- Timeouts: bound subprocess evidence checks.
- `worktree` error mapping: preserve upstream `failure_domain`, `changed_state`, and `next_safe_action`.
- Adoption order: doctor, read commands, write commands, then `worktree` migration.

Rationale:

- These defaults make CLI results routable by agents without reading prose.
- Status/check separation prevents evidence reads from becoming hidden permission gates.
- Object envelopes and projection flags keep large outputs evolvable.
- Named recovery actions avoid unsafe copy-run behavior.

Consequences:

- Public JSON and CLI help should use these names even if internal TypeScript helpers differ.
- Read-heavy commands should advertise the projection flags before outputs become context-heavy.
- Failure records and `worktree` wrapping must preserve recovery fields instead of collapsing to generic errors.

Next:

- Keep this as scaffold/contract pressure until behavior units implement the full schemas.
- Add implementation tests per unit before changing runtime semantics.
