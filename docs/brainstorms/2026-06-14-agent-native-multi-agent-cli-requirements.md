---
date: "2026-06-14"
topic: agent-native-multi-agent-cli
---

# Agent-Native Multi-Agent CLI Requirements

## Summary

Build a repo-local shared runtime package that rebuilds SideQuest Git's useful git and worktree logic inside this repo, then expose it through a facade-backed agent-native CLI. The product promise is that an agent can mutate a repo, fail halfway, and the next agent can inspect exactly where reality landed. The first product surface is a repo `doctor` command that gives agents a reliable state map, recovery path, and next safe action before mutation.

---

## Problem Frame

SideQuest Git has useful worktree behavior, but it was not shaped as a first-class multi-agent development product. It gives us logic to port, not a product contract to keep.

The current `worktree` skill is the right workflow entry point for day-to-day worktree and VS Code workspace workflows, but it still delegates git/worktree truth to `@side-quest/git`. That leaves the agent-native recovery contract split across a skill, an external CLI, and local glue.

The new product should make repo state inspectable before agents mutate it. Failures should expose cause, changed state, retry safety, diagnostics, and next safe actions without asking a future agent to reconstruct context from terminal scrollback.

---

## Key Decisions

- **Shared inline runtime package over external dependency.** Rebuild the SideQuest Git subset inside this repo as a shared workspace package so `worktree` and future skills consume one local owner for git, worktree, hygiene, and recovery behavior.

- **Doctor first, mutation second.** The first product surface is the state map. Create/delete/clean flows come after agents can inspect repo readiness and failure causes.

- **Facade-backed from the start.** The CLI is agent-native and facade-backed, with discovery metadata, rendered help, parser acceptance, runtime semantics, and command behavior proven together.

- **`worktree` remains the workflow entry point.** The skill should route humans and agents into the new package instead of growing its own git/worktree logic.

- **SideQuest is source material, not product identity.** Port proven create/list/check/delete/clean/recover/status behavior, but do not preserve old naming or output shapes when they fight the new recovery contract.

- **Agent-recoverable repo product over CRUD package.** Preserve the SideQuest-derived lanes that make the product exciting: status watch, lightweight context snapshot, safety gate, merge intelligence, config sync, recovery refs, event tail, and durable event trail.

- **Merge intelligence is core.** Cleanup, delete, and status decisions should retain ancestor merge, squash merge, ahead/behind, shallow clone, and upstream-gone evidence rather than falling back to weak branch heuristics.

---

## Actors

- A1. **Driver agent:** Runs the CLI, parses envelopes, chooses next safe actions, and resumes after failures.
- A2. **Human operator:** Reviews state, approves destructive actions, and resolves ambiguous handoffs.
- A3. **Workflow entry point:** `worktree` and later skills call the shared package through stable command contracts.
- A4. **Shared runtime package:** Owns git/worktree state, hygiene checks, recovery vocabulary, and durable diagnostics.
- A5. **Planner/reviewer:** Reads the requirements and later plans without inventing product scope.

---

## Key Flows

- F1. **Inspect repo readiness**
  - **Trigger:** An agent starts work in a repo or linked worktree.
  - **Actors:** A1, A4.
  - **Steps:** The agent runs doctor; the CLI resolves repo ownership, worktree state, command readiness, stale worktree dirs, dependency readiness, and blocked mutations.
  - **Outcome:** The agent receives a structured state map plus next safe actions.
  - **Covered by:** R1, R2, R3, R4.

- F2. **Recover from a failed command**
  - **Trigger:** A command fails due to usage, environment, git state, destructive safety, or runtime error.
  - **Actors:** A1, A2, A4.
  - **Steps:** The CLI emits a structured error envelope, records diagnostic context, names changed state, and offers recovery choices or human handoff.
  - **Outcome:** A later agent can continue from the failure without reading the original transcript.
  - **Covered by:** R5, R6, R7.

- F3. **Use `worktree` through the new owner**
  - **Trigger:** A human or agent asks to create, remove, clean, render, or open worktrees through `worktree`.
  - **Actors:** A1, A2, A3, A4.
  - **Steps:** `worktree` calls the shared package for git/worktree truth, then keeps owning workspace rendering and VS Code ergonomics.
  - **Outcome:** The workflow entry point stays simple while git/worktree behavior moves into the shared runtime owner.
  - **Covered by:** R8, R9, R10.

- F4. **Clean repo hygiene safely**
  - **Trigger:** An agent or human wants to prune old worktrees, orphan branches, or stale worktree directories.
  - **Actors:** A1, A2, A4.
  - **Steps:** The CLI previews eligible cleanup, distinguishes branch orphans from stale directories, requires explicit confirmation for destructive actions, and records what changed.
  - **Outcome:** Cleanup is safe, inspectable, and recoverable where possible.
  - **Covered by:** R11, R12, R13.

---

## Requirements

**Product shape**

- R1. The new CLI must expose `doctor` as the primary read command for repo operability.
- R2. Doctor output must include repo root, durable owner worktree, linked worktrees, dirty state, stale worktree dirs, orphan branch health, package readiness, command availability, and blocked mutations.
- R3. Doctor output must include next safe actions that an agent can choose without scraping human text.
- R4. Doctor must succeed in dirty or partially broken repos whenever read-only inspection is still possible.

**Failure and recovery**

- R5. Every known failure must answer what happened, what changed, whether same-input retry is safe, what to try next, and where diagnostics live.
- R6. Failure envelopes must include run correlation and recovery classification.
- R7. Commands that can fail after partial progress must leave enough durable state for a later agent to inspect or resume.

**Shared package and CLI contract**

- R8. The SideQuest Git rebuild must live in this repo as a shared workspace package consumed by `worktree` and future skills.
- R9. The shared package must own git/worktree model vocabulary, state discovery, cleanup policy, destructive safety, and recovery result vocabulary.
- R10. The public CLI must be facade-backed and include a Command Surface Alignment Proof covering discovery metadata, rendered help, public argv outcomes, and runtime semantics.

**Worktree lifecycle**

- R11. The package must support worktree create, list, check, delete, clean, recover, status, and sync behaviors at parity with the useful SideQuest Git subset.
- R12. Cleanup must distinguish registered worktrees, orphan branches, and stale filesystem directories.
- R13. Destructive cleanup must be preview-first and require explicit force or operator confirmation in non-interactive contexts.

**`worktree` integration**

- R14. `worktree` must keep owning VS Code workspace rendering, focus/color preferences, drift gates, and open behavior.
- R15. `worktree` must stop depending on `@side-quest/git` once the shared package exposes equivalent worktree lifecycle behavior.
- R16. `worktree` must report shared-package failures through its own facade envelope without losing the upstream recovery classification.

**Agent-native operation**

- R17. The CLI must support a non-interactive path for every command.
- R18. Primary machine data must be parseable without human prose.
- R19. Diagnostics must go to stderr or persisted diagnostic surfaces, not mixed into JSON stdout.
- R20. Large outputs must have projection or field-selection controls so agents can stay inside context budget.

**Product vision lanes**

- R21. The package must preserve merge intelligence as a core planning lane for status, check, delete, and cleanup decisions.
- R22. The package must preserve durable run/event trails as a product lane so agents can inspect what happened without reading transcripts.
- R23. The package must preserve recovery refs and backup refs as a product lane for partial mutation and destructive-action recovery.
- R24. The package must preserve safety gates and lightweight context snapshots as pre-mutation product lanes.
- R25. The package must preserve status watch, event tail, and config sync as roadmap lanes even if v1 ships only a subset.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given an agent starts in a linked worktree, when it runs doctor, then the output identifies the main worktree owner, the active worktree, readiness blockers, and at least one next safe action.

- AE2. **Covers R4, R5.** Given the repo has dirty files and a malformed worktree config, when doctor runs, then it still returns all readable state and marks only the unreadable checks as blocked.

- AE3. **Covers R7.** Given a cleanup command deletes one safe worktree and fails on a second, when another agent inspects the run, then the agent can see what changed, what failed, and whether retrying the same input is safe.

- AE4. **Covers R11, R12, R13.** Given a repo has an orphan branch and an unregistered directory under the worktree folder, when cleanup previews, then the output classifies them separately and does not delete either without explicit destructive intent.

- AE5. **Covers R14, R15, R16.** Given `worktree clean` calls the shared package and the shared package blocks on dirty state, when `worktree` returns, then its envelope preserves the shared failure category and points to the safe inspection path.

- AE6. **Covers R17, R18, R19.** Given a command runs with `--no-input --json`, when it succeeds or fails, then stdout contains only parseable machine data and stderr contains diagnostics or error output.

---

## Success Criteria

- A fresh agent can run doctor and know whether the repo is safe to mutate.
- `worktree` can create, remove, clean, and render worktrees without shelling to `@side-quest/git`.
- Worktree cleanup covers stale directories separately from orphan branches.
- Merge intelligence explains cleanup and delete safety.
- Durable run/event trails let a later agent inspect what changed.
- Known failures carry retry safety, changed-state information, and a next safe action.
- The CLI passes a command-surface proof for help, parser, discovery, and runtime behavior.
- SideQuest Git logic is ported selectively, with old product shape removed rather than wrapped.

---

## Scope Boundaries

**Deferred for later**

- Multi-agent lease ownership and conflict domains.
- Auto-merge queues and branch integration policy.
- Human dashboard or browser UI.
- Full task tracker semantics.
- Cross-machine distributed locking.
- Status watch and event tail beyond durable run/event logs.
- Config sync and install hooks beyond the minimum needed for `worktree` migration.

**Outside this product's identity**

- A generic project-management app.
- A chat transcript summarizer as the source of truth.
- A thin alias around SideQuest Git.
- A visual-first worktree dashboard before the CLI contract exists.

---

## Dependencies And Assumptions

- The repo continues using Bun workspaces for shared runtime packages.
- `@side-quest/cli-command-facade` remains the enforcement backend for the public CLI surface.
- SideQuest Git remains available as source material during porting, but not as the target runtime dependency.
- `worktree` is the first consumer and proof target for the shared package.
- The accepted package identity is `agent-worktree`, with `agent-worktree` as the canonical command and `agent-worktree` as the alias.

---

## Outstanding Questions

**Resolve before planning**

- Which SideQuest Git behaviors are strict parity requirements for v1, and which should be redesigned immediately?
- Which product vision lanes are v1 core, v1 optional, or post-v1?

**Deferred to planning**

- Exact package export names.
- Exact command tree under the new CLI.
- Diagnostic persistence location and retention policy.
- Migration sequence for replacing `@side-quest/git` in `worktree`.

---

## Sources

- `AGENTS.md`
- `skills/worktree/SKILL.md`
- `skills/worktree/src/command-contract.ts`
- `skills/worktree/src/worktree.ts`
- `skills/worktree/src/worktree-discovery.ts`
- `skills/cli-author/SKILL.md`
- `skills/cli-author/references/agent-native-cli-design.md`
- `skills/cli-author/references/cli-command-facade.md`
- `skills/agent-reliability-guardrails/references/error-envelope-schema.md`
- `docs/ideation/2026-06-14-agent-native-multi-agent-cli-ideation.html`
- `docs/git/worktree.md`
