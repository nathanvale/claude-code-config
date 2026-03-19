---
title: "QMD Federation"
type: reference
status: active
updated: 2026-03-17
summary: "Shared QMD roster and collection conventions for broad federated recall across Markdown repos."
---

# QMD Federation

## Purpose

Define the broad recall layer for the Memory OS.

QMD is the default federated search substrate across participating repos. It should cover the broad Markdown corpus so agents can answer "what do we already know?" without copying everything into one place.

## Canonical Roster

Use `~/.config/memory/federation/roster.yml` as the machine-readable source of participating repos and collection names.

Use `bun run ~/.config/memory/scripts/qmd-roster-sync.ts` from any repo, or `bun run memory:qmd-federation` from the dotfiles repo, to turn that roster into a plan, command list, or applied QMD configuration.

The sync script should do two things from the roster:
- build a collection mask from `primary_paths` so indexing stays within the intended docs surface
- add collection-level and path-level context so recall is aware of repo role and major note surfaces
- set an optional `update_command` for each collection when a repo benefits from pre-update refresh behavior

## Installation

QMD is not currently managed through Homebrew.

Install prerequisites and the CLI with:

```sh
brew bundle --file=~/code/dotfiles/config/brew/Brewfile
bun install -g @tobilu/qmd
```

Then verify:

```sh
qmd --help
bun run memory:qmd-federation status
```

For vector-heavy operations on this machine, prefer the Node wrapper:

```sh
~/.config/memory/scripts/qmd-node.sh status
~/.config/memory/scripts/qmd-node.sh embed
```

For the full maintenance flow, use the refresh helper:

```sh
~/.config/memory/scripts/qmd-refresh.sh
~/.config/memory/scripts/qmd-refresh.sh --skip-embed
```

For agent access, expose the QMD MCP server through the stable wrapper:

```sh
~/.config/memory/scripts/qmd-mcp.sh
```

## Collection Naming

- `vault` for `my-second-brain`
- `repo-<slug>` for other repos

Examples:
- `vault`
- `repo-monash-smst`
- `repo-mac-mini-home-server`

## Rules

- Index note bodies and metadata.
- Prefer one collection per repo docs surface.
- Build the collection mask from the roster's `primary_paths`, not from the entire repo root.
- Add path-level context for major note surfaces such as `docs/`, `memory/`, `TASKS.md`, and `CLAUDE.md`.
- Prefer conservative `update_command` values. On git-backed repos, `git fetch --all --prune --quiet || true` is safer than auto-stashing and pulling.
- For reference-corpus repos, index converted Markdown surfaces such as `apis/` or `repos/`, not raw upstream downloads.
- Run QMD CLI maintenance and inspection commands sequentially against a given index; concurrent calls can hit SQLite lock errors.
- Prefer `~/.config/memory/scripts/qmd-node.sh` for embedding and other vector-heavy operations on this machine; the Bun-installed `qmd` binary can fail to load `sqlite-vec` under Bun.
- Keep source-of-truth ownership with the repo.
- Add a new repo to the roster before relying on it in shared recall workflows.
- Treat the roster as canonical and regenerate commands from it rather than hand-maintaining setup snippets.

## Default Read Targets

For each repo, prefer the narrowest useful docs surface rather than the entire working tree.

Examples:
- `my-second-brain`: vault markdown plus selected system docs
- `monash-smst`: `docs/`, `memory/`, `TASKS.md`, `CLAUDE.md`, `AGENTS.md`
- `mac-mini-home-server`: `docs/`, `memory/`, `TASKS.md`, `CLAUDE.md`, `AGENTS.md`
- `ellucian-api-catalog`: `apis/`, `CLAUDE.md`, `AGENTS.md`
- `ellucian-developer`: `repos/`, `CLAUDE.md`, `AGENTS.md`
