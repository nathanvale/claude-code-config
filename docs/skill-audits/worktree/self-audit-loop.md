---
target_skill: skills/worktree/SKILL.md
status: active
passes: 0
last_pass: null
convergence: not_started
---

# Skill Self-Audit Loop: worktree

## Truth Stance

- This file is audit state.
- This file is not canonical skill instruction.
- Research explains loop shape only.
- Findings require local source evidence.
- Repair source through `skills/create-skill/SKILL.md`.
- Add a helper only after real loop files show ledger-shape drift, duplicate-signature confusion, false convergence claims, or privacy-redaction drift; use `skills/create-cli/SKILL.md` first.

## Driver Commands

Short path:

```text
/goal Read docs/skill-audits/worktree/self-audit-loop.md and audit the target SKILL.md for instruction contradictions. Update only the audit loop file. Stop when a fresh pass adds zero new accepted contradictions.
```

Full path:

```text
/goal Resume the skill self-audit loop from docs/skill-audits/worktree/self-audit-loop.md. Read the loop file first, then the target SKILL.md, then the owner paths named there. Audit only authority, scope, lifecycle, and safety contradictions. Update only the audit loop file. Do not edit skill source. Continue fresh passes until one pass adds zero new accepted contradictions, or mark blocked when evidence, authority, loop state, privacy, or a human decision prevents honest convergence.
```

One-pass fallback:

```text
/loop Read docs/skill-audits/worktree/self-audit-loop.md first. Run the next numbered audit pass only. Update only the audit loop file. Stop after recording the pass result, next safe action, and file status.
```

## Target

- Skill: `worktree`.
- Target path: `skills/worktree/SKILL.md`.
- Audit file: `docs/skill-audits/worktree/self-audit-loop.md`.

## Scope

- Audit one target `SKILL.md`.
- Audit instruction contradictions only.
- Do not edit target skill source.
- Do not audit every skill in the repo.

## Loaded Owner Paths

- `skills/skill-self-audit-loop/SKILL.md`.
- `skills/create-skill/references/skill-design-decision-runbook.md`.
- `skills/context-advisor/references/storage-routing.md`.
- `skills/create-skill/SKILL.md`.
- `skills/create-cli/SKILL.md`.
- `skills/worktree/SKILL.md`.
- `skills/worktree/src/command-contract.ts`.
- `skills/worktree/src/model.ts`.
- `skills/worktree/src/worktree-engine.ts`.
- `skills/worktree/src/worktree-discovery.ts`.
- `skills/worktree/src/worktree.ts`.
- `skills/worktree/src/worktree.test.ts`.
- `docs/git/worktree.md`.
- `docs/plans/2026-06-14-001-feat-worktree-worktree-workspace-renderer-plan.md`.
- `docs/brainstorms/2026-06-14-worktree-worktree-workspace-renderer-requirements.md`.

## Skipped Owner Paths

- `worktree.config.json`: absent in this checkout; gitignored local registry. Load it before accepting a registry-source contradiction.
- `<repo>.code-workspace`: generated output. Present artifacts `claude-code-config.code-workspace` and `skills/worktree.code-workspace` were not loaded; source owners are `skills/worktree/src/worktree-engine.ts`, `skills/worktree/src/worktree-discovery.ts`, and `worktree.config.json`.
- `skills/skill-self-audit-loop/references/loop-proof-methods.md`: no loop helper or shape promotion being changed or proven.
- `docs/brainstorms/2026-06-10-skill-self-audit-loop-requirements.md`: research anchor for loop design; not needed for creating the `worktree` loop file.
- `skills/create-cli/references/cli-guidelines.md`: no CLI surface change in this setup pass.
- `skills/create-cli/references/agent-native-cli-design.md`: no CLI surface change in this setup pass.
- `skills/create-cli/references/cli-command-facade.md`: no CLI surface change in this setup pass.
- `skills/create-skill/references/skill-io-shape-examples.md`: no skill-source create, repair, or IO-shape decision in this setup pass.

## Pass Ledger

- No passes yet.

## Open Findings

- None yet.

## Finding History

- None yet.

## Unresolved Questions

- None yet.

## Dedupe Warnings

- None yet.

## Candidate Shapes

- None yet.

## Repair Candidates

- None yet.

## Stop Rule

- Converged: a fresh pass adds zero new accepted contradictions.
- Active: at least one open finding remains or the next pass is needed.
- Blocked: evidence is missing, authority is unclear, loop state is corrupt, privacy prevents recording evidence, or a human decision is required.
- Dedupe warnings do not block convergence by themselves.
- Maximum-pass limits are cost guards, not proof of convergence.

## Research Anchors

- `docs/brainstorms/2026-06-10-skill-self-audit-loop-requirements.md`.

## Next Safe Action

- Run the copyable `/goal` command above.
