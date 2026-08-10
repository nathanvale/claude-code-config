# Claude Code Config

Shared Claude Code and Codex workflows: context routing, rules, skills, agents, and the Setup CLI.

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
./setup sync --check
```

Run `./setup sync --check` to preview direct first-party skill links, declared
PATH bins, copied hooks, and runbook health. Run `./setup sync` to apply the safe
plan. Dotfiles owns global instruction delivery.

The root `./setup` command works without preinstalled Bun or workspace
dependencies. It asks before installing missing Bun, reconciles frozen
dependencies, then delegates to the facade-backed CLI.

For non-interactive bootstrap, pass `--yes` to consent to Bun installation:

```sh
./setup --yes
```

`--yes` grants Bun installation consent only.

### Verify

```sh
./setup status
./setup catalog agent-instructions
```

## Existing Machine

```sh
./setup status          # bounded health and next action
./setup doctor          # diagnose topology and ownership evidence
./setup sync --check    # preview current evidence
./setup sync            # apply safe skills, bins, and hooks
./setup unlink --check  # preview managed removal
./setup unlink          # remove proven Setup-owned links
```

Setup reconciles copied hooks only when provenance or recognized migration
evidence proves ownership. Missing or unproven evidence preserves the hook and
routes repair to a human; inspect with `./setup status`, `./setup doctor`, or
`./setup sync --check` before applying a safe plan with `./setup sync`.

Invoke the manual `agent-instructions` skill to audit, preview, apply, or prove
global Claude and Codex instruction delivery through the dotfiles owner.

Use `./setup catalog <id>` before third-party acquisition. Use
`bunx skills add <source> -s <skill>` for third-party acquisition. Use the
`bunx skills` command family for other third-party lifecycle work; Setup never
acts as a package manager.

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
