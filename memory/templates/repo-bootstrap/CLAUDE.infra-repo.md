# Infra Repo Hot Memory

## Project

- This repo owns local operational truth for infrastructure, tooling, or platform work.

## Current Focus

- Keep this file lean.
- Use it for active operating context only.
- Move durable detail into `memory/` and full authored material into `docs/`.

## Always / Never

- Keep only the few rules that matter in most sessions.
- Put stable workflow rules in `AGENTS.md`.
- Do not store large reference inventories here.

## Key Paths

- `AGENTS.md` for durable repo rules
- `TASKS.md` for the active dashboard
- `todos/` only when work becomes dependency-heavy
- `memory/` for durable compact recall
- `docs/` for plans, specs, runbooks, ADRs, verification, and research

## Memory OS

- Shared user-scope contract: `~/.config/memory/AGENTS.md`
- Repo profile: `infra-repo`
- Use exactly one repo-level hot-memory file.
