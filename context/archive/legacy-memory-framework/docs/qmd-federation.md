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

Use `~/.config/context/federation/roster.yml` as the machine-readable source of participating repos and collection names.

Use `bun run ~/.config/context/scripts/qmd-roster-sync.ts` from any repo, or `bun run memory:qmd-federation` from the dotfiles repo, to turn that roster into a plan, command list, or applied QMD configuration.

The sync script should do two things from the roster:
- build a collection mask from `primary_paths` so indexing stays within the intended docs surface
- add collection-level and path-level context so recall is aware of repo role and major note surfaces
- set an optional `update_command` for each collection when a repo benefits from pre-update refresh behavior

## Installation

### Prerequisites

```sh
brew install sqlite yq
```

You also need **bun** (for roster sync tooling) and **node + npm** (for the QMD runtime). If using fnm:

```sh
fnm install --lts
```

### Install QMD

Use **npm**, not bun. The `qmd-node.sh` wrapper runs QMD under Node, so `better-sqlite3` must be compiled against Node's ABI. Installing with `bun install -g` compiles the native addon for Bun's ABI, which causes `ERR_DLOPEN_FAILED` when Node loads it.

```sh
npm install -g @tobilu/qmd
```

### Symlinks

This topology is retired. Setup links `~/.config/context` to the current root
`context/`; it does not expose this archive's QMD wrappers. Treat the commands
below as historical evidence unless QMD receives a new active owner.

### Bootstrap federation

```sh
~/.config/context/scripts/qmd-refresh.sh
```

This runs three steps sequentially:
1. **Roster apply** — registers collections from `roster.yml` (repos not cloned on this machine are skipped automatically)
2. **Index** — indexes markdown in each collection
3. **Embed** — generates vector embeddings (use `--skip-embed` if you only need lexical search)

### Verify

```sh
~/.config/context/scripts/qmd-node.sh status
~/.config/context/scripts/qmd-node.sh embed   # should complete without sqlite-vec errors
```

### MCP server

The historical `.mcp.json` topology was symlinked into `~/.claude/.mcp.json`. QMD is no longer an active runtime route; this section is retained as archive evidence.

```sh
~/.config/context/scripts/qmd-mcp.sh
```

This delegates through `qmd-node.sh` so the MCP server gets the same brew prefix and Node runtime as all other QMD operations.

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
- Add path-level context for major note surfaces such as `docs/`, `context/`, `TASKS.md`, and `CLAUDE.md`.
- Prefer conservative `update_command` values. On git-backed repos, `git fetch --all --prune --quiet || true` is safer than auto-stashing and pulling.
- For reference-corpus repos, index converted Markdown surfaces such as `apis/` or `repos/`, not raw upstream downloads.
- Run QMD CLI maintenance and inspection commands sequentially against a given index; concurrent calls can hit SQLite lock errors.
- Always use `~/.config/context/scripts/qmd-node.sh` for QMD operations. The wrapper runs QMD under Node (not Bun) to avoid macOS SQLite extension loading issues, auto-detects Homebrew's `BREW_PREFIX`, and probes both npm and bun global paths for the CLI. Install QMD with `npm install -g` so `better-sqlite3` compiles against Node's ABI.
- Keep source-of-truth ownership with the repo.
- Add a new repo to the roster before relying on it in shared recall workflows.
- Treat the roster as canonical and regenerate commands from it rather than hand-maintaining setup snippets.

## Multi-Machine Notes

### Node ABI compatibility

`qmd-node.sh` derives the correct `node` binary from the same npm prefix where QMD is installed. This guarantees `better-sqlite3` loads against the ABI it was compiled for, regardless of what other Node versions exist on `$PATH`.

If you see `ERR_DLOPEN_FAILED` or `NODE_MODULE_VERSION` mismatch errors:

1. Check which node QMD is installed under: `npm root -g`
2. Trace the wrapper: `bash -x ~/.config/context/scripts/qmd-node.sh status`
3. If needed, reinstall: `fnm use default && npm install -g @tobilu/qmd`

### Roster sync and subprocesses

`qmd-roster-sync.ts` invokes QMD via the `qmd-node.sh` wrapper (resolved from `QMD_NODE` env var or co-located script path). This ensures subprocess calls also use the correct Node binary in non-interactive shells (MCP, SSH, cron).

## Default Read Targets

For each repo, prefer the narrowest useful docs surface rather than the entire working tree.

Examples:
- `my-second-brain`: vault markdown plus selected system docs
- `monash-smst`: `docs/`, `context/`, `TASKS.md`, `CLAUDE.md`, `AGENTS.md`
- `mac-mini-home-server`: `docs/`, `context/`, `TASKS.md`, `CLAUDE.md`, `AGENTS.md`
- `ellucian-api-catalog`: `apis/`, `CLAUDE.md`, `AGENTS.md`
- `ellucian-developer`: `repos/`, `CLAUDE.md`, `AGENTS.md`
