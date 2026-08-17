---
status: accepted
date: 2026-06-02
---

# Lean Startup Instructions

> **Setup amendment (2026-07-13):** Root `setup` and `runtime/setup/` now own
> startup topology, hook installation, instruction-health composition, and
> direct first-party skill projection. `bunx skills` remains the third-party
> acquisition owner. The lean-authoring decision remains accepted.

> **Personal instruction amendment (2026-08-16):** Dotfiles now owns personal
> Claude Code and Codex instruction setup through its project-scoped
> `agents-md-setup` skill. This repository keeps only its repository
> instructions and no longer creates, removes, or checks personal instruction
> files.

## Decision

Root `AGENTS.md` is this repository's canonical instruction source.

Prompt fragments, committed Codex generated output, and
`docs/specs/prompt-system.md` are retired as authoring surfaces.

`scripts/agent-instructions.sh` owns read-only instruction health:

- startup line budgets
- owner route existence
- global leakage checks
- appendix bloat checks
- user-scope delivery drift

Setup owns runtime topology and surfaces instruction health without generating
prompt content.

The pre-commit adapter enforces instruction health at the commit boundary.
Setup owns the topology boundary: hook installation, inspection, and safe
reconciliation of copied hooks backed by provenance.

Missing provenance alone does not transfer ownership to Setup. Equal-current
or recognized migration evidence may rebuild it; every other existing copy is
preserved and routed to human repair after state loss.

Personal Claude Code and Codex delivery belongs to the dotfiles project. This
repository points to that owner instead of copying its contract.

## Rationale

The fragment renderer solved an earlier drift problem, but it became a second
control plane and let startup instructions grow into handbook prose.

Lean authoring keeps the model simple:

- edit one startup source
- move depth to owner docs and skills
- let runtime checks enforce drift and budgets

## Live Sources

- Repository instruction source: `AGENTS.md`
- Personal instruction setup:
  `$HOME/code/dotfiles/.agents/skills/agents-md-setup/SKILL.md`
- Runtime health: `scripts/agent-instructions.sh`
- Install topology: `setup` and `runtime/setup/`
- Vocabulary: `CONTEXT.md`
- Repo truth: `docs/agents/`
- Git procedure: `docs/git/`
- Workflow owners: `skills/*/SKILL.md`

## Delivery Topology

- Personal instruction adapters are regular files owned and verified by the
  dotfiles project skill.
- Setup excludes `~/.claude/CLAUDE.md`, `~/.claude/AGENTS.md`, and
  `~/.codex/AGENTS.md` from its startup topology.
- Skill projection: `skills/` is the first-party source; Setup creates direct per-skill links in `~/.claude/skills/` and `~/.agents/skills/`. A real entry or foreign symlink that shadows a source skill is preserved and diagnosed.
- Health check: `scripts/agent-instructions.sh check --json` proves repository
  instruction line budgets, owner paths, leakage, and appendices. Setup
  composes that evidence with its remaining topology health.
- Hook topology: Setup reconciles copied hooks only from provenance-backed or recognized migration evidence; unproven content is preserved for human repair.

## Registered Owners

Registered context owners and Claude rules are checked into the repo and loaded by the harness at startup. They are not startup prose; the ADR records the routing principle, not the live inventory.

- Context owners live under `context/`: on-demand lookup facts and durable recall (e.g. `context/personal.md`, `context/bun-runner.md`). Inventory owner: `context/AGENTS.md`.
- Claude rules live under `rules/`: Claude runtime behavior, not shared Codex startup behavior (e.g. `rules/security-boundaries.md`). Inventory owner: the harness rules-discovery system.

## Supersedes

- `docs/decisions/2026-03-22-fragment-rendering-over-manual-sync.md`
- `docs/decisions/2026-03-22-codex-output-is-copy-not-symlink.md`
- `docs/specs/prompt-system.md`
