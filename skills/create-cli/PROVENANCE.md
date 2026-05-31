# Provenance: create-cli

Source: [steipete/agent-scripts](https://github.com/steipete/agent-scripts) — `skills/create-cli/`
License: MIT © 2026 Peter Steinberger (see `LICENSE.upstream`)
Pulled: 2026-05-29 (sparse checkout of `main`)

## Status: verbatim core + side-quest facade reference

`SKILL.md` body + `references/cli-guidelines.md` (a condensed clig.dev rubric) remain the verbatim
upstream copy — pure design methodology, language/runtime-agnostic, still diffable against upstream.

Side-quest additions (not upstream): `references/cli-command-facade.md` (maps each clig.dev pattern
to a `@side-quest/cli-command-facade` field/helper + a TS+Bun wire-up), one pointer line under "Do
This First", and a `scripts/` folder that npm-links the package. These encourage implementing
designed CLIs with TypeScript + Bun against the facade. The design philosophy stays agnostic; only
the recommended *implementation* path is side-quest-flavored and depends on a private, cross-repo
package (machine-local link).

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

**Integration design** (the create-cli spec → `CommandFacadeContract` field mapping, and the
"make create-cli emit the contract skeleton directly" next step) is captured in
side-quest-engineering: `docs/brainstorms/2026-05-29-002-facade-aware-create-cli-integration.md`.

Upstream rubric: https://clig.dev/
