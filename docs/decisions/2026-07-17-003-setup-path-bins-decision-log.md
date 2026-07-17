---
title: Setup PATH Bins Decision Log
slug: setup-path-bins
type: decision-log
status: in-progress
date: "2026-07-17"
timezone: Australia/Melbourne
owner: setup-path-bins
source:
  - docs/plans/2026-07-17-002-feat-setup-path-bins-plan.md
  - https://github.com/nathanvale/claude-code-config/issues/242
decision_metadata_format: fenced-yaml-per-decision
---

# Setup PATH Bins Decision Log

## Frame

Issue #242: agents following browser-use's SKILL.md from a foreign CWD dead-ended because the documented CLI bins existed nowhere on PATH. This surface owns how repo CLI bins (`browser-connect`, `warm-chrome`, `browser-use`, `setup`) are delivered, verified, and removed.

## Notes

- `runners/*` bins stay out of enumeration scope until a foreign-CWD need is demonstrated.

## Decision 1: Repo CLI bins are delivered as direct setup-owned symlinks in ~/.bun/bin, pla...

```yaml
id: setup-path-bins-001
status: accepted
decided_at: "2026-07-17"
decision: "Repo CLI bins are delivered as direct setup-owned symlinks in ~/.bun/bin, planned/applied/verified/removed by the existing setup command surfaces."
owner: "setup-path-bins"
source:
  - "docs/plans/2026-07-17-002-feat-setup-path-bins-plan.md"
  - "https://github.com/nathanvale/claude-code-config/issues/242"
```

Decision:

- Deliver every declared `runtime/*` and `skills/*` CLI bin as a direct symlink `~/.bun/bin/<name> -> <repo>/<pkg>/<entry>` owned by the setup bins domain.
- Reject `bun link`, `npm link`, and global installs as delivery mechanisms.

Rationale:

- `bun link` is project-scoped and does not expose bins on PATH; `bun install -g` copies without source tracking; `npm link` adds a second package manager's unmanaged global state.
- Direct symlinks are inspectable, idempotent, and land in the one domain (`setup`) that already proves and repairs link ownership.
- `~/.bun/bin` is already on PATH and precedented for dev bins.

Consequences:

- Bins ride `setup sync`/`status`/`doctor`/`unlink` with the existing user-scope lock, fail-closed ownership proofs (realpath-inside-repo plus lexical dangling fallback), and findings vocabulary; no new commands or flags.
- PATH-presence and orphan evidence ride a non-blocking advisory channel, so machines without `~/.bun/bin` degrade to a warning instead of a blocked sync.

Next:

- Keep bin declarations in each package's `package.json` (`setup.pathBin` override or `#bin` fallback); never hand-create links in `~/.bun/bin`.

V2 Ideas:

- Extend enumeration to `runners/*` if a foreign-CWD need for runner bins is demonstrated.

## Decision 2: PATH bins execute TypeScript entrypoints directly via Bun shebangs; dist buil...

```yaml
id: setup-path-bins-002
status: accepted
decided_at: "2026-07-17"
decision: "PATH bins execute TypeScript entrypoints directly via Bun shebangs; dist builds never enter the delivery path."
owner: "setup-path-bins"
source:
  - "docs/plans/2026-07-17-002-feat-setup-path-bins-plan.md"
  - "https://github.com/nathanvale/claude-code-config/issues/242"
```

Decision:

- Link PATH bins to `#!/usr/bin/env bun` TypeScript entrypoints inside the repo; a declared entry that is missing or lacks a shebang is a finding, never a silently created broken link.
- `browser-use` declares `setup.pathBin` pointing at `./src/browser-use.ts` so its uncommitted `dist/` bin never enters PATH delivery; `dist/` remains an npm-pack concern.

Rationale:

- Bun executes TS directly through the shebang, so no build step can go stale between the repo and the installed bin (`last-30-days -> dist/cli.js` is the observed broken-link failure mode).
- The authoritative proof is the live smoke gate: a foreign-CWD run through a fresh direct symlink, not the since-dangling `cortex` bun-global precedent.

Consequences:

- Workspace imports resolve via the repo's physical path because Bun resolves modules from the link target's realpath.
- Packages that publish a compiled bin keep `#bin` for npm while overriding PATH delivery with `setup.pathBin`.

Next:

- Run the live smoke (`setup sync`, then `which browser-connect warm-chrome browser-use setup` and an end-to-end `browser-connect connect chrome-devtools-mcp --json` from `$HOME`) whenever bin delivery changes.

V2 Ideas:

- None.
