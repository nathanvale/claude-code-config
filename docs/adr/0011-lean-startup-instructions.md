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

## Supersedes

- `docs/decisions/2026-03-22-fragment-rendering-over-manual-sync.md`
- `docs/decisions/2026-03-22-codex-output-is-copy-not-symlink.md`
- `docs/specs/prompt-system.md`
