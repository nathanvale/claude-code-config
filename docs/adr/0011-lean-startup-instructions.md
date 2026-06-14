---
status: accepted
date: 2026-06-02
---

# Lean Startup Instructions

## Decision

Root `AGENTS.md` is the canonical user-scope startup instruction source.

Prompt fragments, committed Codex generated output, and
`docs/specs/prompt-system.md` are retired as authoring surfaces.

`scripts/agent-instructions.sh` owns read-only instruction health:

- startup line budgets
- owner route existence
- global leakage checks
- appendix bloat checks
- user-scope delivery drift

`install.sh` remains a compatibility topology helper. It surfaces instruction
health but does not generate prompt content.

Claude and Codex delivery should target root `AGENTS.md` directly. A managed
copy is acceptable only as an install artifact checked against `AGENTS.md`.

## Rationale

The fragment renderer solved an earlier drift problem, but it became a second
control plane and let startup instructions grow into handbook prose.

Lean authoring keeps the model simple:

- edit one startup source
- move depth to owner docs and skills
- let runtime checks enforce drift and budgets

## Live Sources

- Startup source: `AGENTS.md`
- Runtime health: `scripts/agent-instructions.sh`
- Install topology: `install.sh`
- Vocabulary: `CONTEXT.md`
- Repo truth: `docs/agents/`
- Git procedure: `docs/git/`
- Workflow owners: `skills/*/SKILL.md`

## Delivery Topology

- Configured startup owner: `agent-instructions.config` `startup_owner`.
- Claude startup wrapper: `~/.claude/CLAUDE.md` symlinks to the configured owner `CLAUDE.md`.
- Claude shared startup: `~/.claude/AGENTS.md` symlinks to the configured owner `AGENTS.md`.
- Codex user startup: `~/.codex/AGENTS.md` symlinks to, or is a managed copy of, the configured owner `AGENTS.md`.
- Skill deploy: `skills/` is the source; `~/.claude/skills` is a whole-folder symlink, `~/.codex/skills` is per-skill symlinks via `install.sh`. A real directory in a deploy target that shadows a repo skill is drift.
- Health check: `scripts/agent-instructions.sh check --json` proves line budgets, owner paths, leakage, appendices, delivery drift, and skill deploy drift.

## Registered Owners

Registered context owners and Claude rules are checked into the repo and loaded by the harness at startup. They are not startup prose; the ADR records the routing principle, not the live inventory.

- Context owners live under `context/`: on-demand lookup facts and durable recall (e.g. `context/personal.md`, `context/bun-runner.md`). Inventory owner: `context/AGENTS.md`.
- Claude rules live under `rules/`: Claude runtime behavior, not shared Codex startup behavior (e.g. `rules/security-boundaries.md`). Inventory owner: the harness rules-discovery system.

## Supersedes

- `docs/decisions/2026-03-22-fragment-rendering-over-manual-sync.md`
- `docs/decisions/2026-03-22-codex-output-is-copy-not-symlink.md`
- `docs/specs/prompt-system.md`
