# Claude Code Config

Nathan's user-scope Claude Code configuration — prompt system, memory, rules, skills, agents, and QMD federated search.

## New Machine Setup

### Prerequisites

```sh
brew install sqlite yq
fnm install --lts
```

You also need [Homebrew](https://brew.sh) and [fnm](https://github.com/Schniz/fnm) (`brew install fnm`).

### Install QMD

Use **npm**, not bun — `better-sqlite3` must compile against Node's ABI:

```sh
npm install -g @tobilu/qmd
```

### Clone and bootstrap

```sh
git clone git@github.com:nathanvale/claude-code-config.git ~/code/claude-code-config
cd ~/code/claude-code-config
./install.sh
```

This symlinks everything into `~/.claude/` and `~/.config/memory/`.

### Bootstrap QMD federation

```sh
~/.config/memory/scripts/qmd-refresh.sh
```

This applies the roster, indexes collections, and generates embeddings. Repos not cloned locally are skipped automatically.

Use `--skip-embed` for a faster first run (lexical search only):

```sh
~/.config/memory/scripts/qmd-refresh.sh --skip-embed
```

### Verify

```sh
~/.config/memory/scripts/qmd-node.sh status
```

### Clone more repos

The more roster repos you have cloned locally, the more collections QMD can search. After cloning additional repos, re-run:

```sh
~/.config/memory/scripts/qmd-refresh.sh
```

## Existing Machine

```sh
./install.sh --status   # check symlink health
./install.sh            # re-apply symlinks
./install.sh --unlink   # remove symlinks
```

## Structure

| Directory | Purpose |
|-----------|---------|
| `rules/` | Auto-applied rules (git safety, code quality, etc.) |
| `context/` | On-demand context docs loaded with `@~/.claude/context/` |
| `skills/` | User-invocable skills (`/name`) |
| `agents/` | Specialized sub-agent definitions |
| `commands/` | Simple one-shot slash commands |
| `hooks/` | Shell hooks for Claude Code events |
| `memory/` | Memory OS — durable recall, federation, scripts |
| `scripts/` | Prompt rendering and build scripts |
