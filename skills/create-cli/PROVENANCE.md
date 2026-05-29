# Provenance: create-cli

Source: [steipete/agent-scripts](https://github.com/steipete/agent-scripts) — `skills/create-cli/`
License: MIT © 2026 Peter Steinberger (see `LICENSE.upstream`)
Pulled: 2026-05-29 (sparse checkout of `main`)

## Status: VERBATIM COPY — usable as-is

`SKILL.md` + `references/cli-guidelines.md` (a condensed clig.dev rubric). Unlike browser-use /
one-password / peekaboo, this skill carries NO steipete-specific paths, vaults, or binaries — it's
pure design methodology, language/runtime-agnostic. No adaptation needed.

## Why it's here — pairs with @side-quest/cli-command-facade

create-cli is the **design/spec front-end**; `packages/cli-command-facade` (in
side-quest-engineering, status: graduated) is the **runtime that implements the contract**. They
compose:

- **create-cli** authors the CLI contract: command tree, args/flags table, `--json`/`--plain`
  output rules, exit-code map (0/1/2), `--dry-run`/confirm/`--no-input` safety, config precedence
  (flags > env > project > user > system), 5–10 example invocations.
- **cli-command-facade** enforces it at runtime: command grammar, JSON writer mechanics, discovery
  projection, result/runtime contract, CLI diagnostic plumbing.

Conventions overlap by design (`--json`, exit codes 0/1/2, subcommand trees, stdout/stderr
discipline) — create-cli is the "design the contract before building the command" step the facade
was missing a named front-end for. Use create-cli when adding/redesigning a command surface in any
side-quest plugin (browser-automation, bun-runner, biome-runner, tsc-runner, etc.), then implement
against the facade.

Upstream rubric: https://clig.dev/
