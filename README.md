# Claude Code Config

Nathan's user-scope Claude Code configuration: prompt system, context routing, rules, skills, agents, and install scripts.

## New Machine Setup

### Prerequisites

```sh
brew install yq
fnm install --lts
```

You also need [Homebrew](https://brew.sh) and [fnm](https://github.com/Schniz/fnm) (`brew install fnm`).

### Clone and bootstrap

```sh
git clone git@github.com:nathanvale/claude-code-config.git ~/code/claude-code-config
cd ~/code/claude-code-config
./install.sh
```

This symlinks active startup rules, skills, agents, commands, hooks, and `~/.config/context/`.

### Setup CLI bootstrap

The root `./setup` command bootstraps the in-progress Setup CLI without requiring
Bun or workspace dependencies first. It asks before installing missing Bun,
then reconciles the frozen workspace dependencies before delegation.

For non-interactive bootstrap, pass `--yes` to consent to Bun installation:

```sh
./setup --yes
```

`--yes` grants Bun installation consent only. Existing `install.sh` commands
remain the active machine-setup owner until the Setup CLI cutover completes.

### Verify

```sh
scripts/agent-instructions.sh check
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
| `context/` | Durable context, references, project summaries, and reusable recall |
| `skills/` | User-invocable skills (`/name`) |
| `agents/` | Specialized sub-agent definitions |
| `commands/` | Simple one-shot slash commands |
| `hooks/` | Shell hooks for Claude Code events |
| `scripts/` | Prompt rendering and build scripts |
