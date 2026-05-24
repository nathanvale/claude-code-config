---
title: "Agent Capability Registry"
type: spec
status: draft
updated: 2026-05-24
summary: "Defines how selected external skills and agents are tracked, adapted, validated, and installed for Claude Code and Codex."
related:
  - docs/specs/prompt-system.md
  - docs/reviews/2026-03-23-prompt-system-review.md
  - https://github.com/nathanvale/claude-code-config/issues/64
---

# Agent Capability Registry

## Purpose

The agent capability registry lets Nathan selectively track external skills and
agents without adopting an entire upstream operating system.

It exists to make imported agent capabilities:

- explicit: selected one capability at a time
- pinned: tied to a known upstream version or commit
- reviewable: upstream snapshots and local adaptations are diffable
- portable: installable into Claude Code and Codex
- safe: validated for language leakage, missing dependencies, and risky behavior

This is a subsystem of `claude-code-config`, which is already the cross-harness
agent governance repo for Claude Code, Codex, prompt fragments, memory
governance, and local skills.

## Vocabulary

**Capability**:
A skill or agent that can be tracked, adapted, validated, and installed.
Capabilities are the primary unit of ownership.

**Source**:
Where a capability came from, such as a Git repository or local plugin cache.
Sources provide provenance. They are not the primary install unit.

**Snapshot**:
The exact upstream copy of a selected capability at a pinned source version.
Snapshots are committed to git and treated as dependency input.

**Canonical capability**:
Nathan's adapted copy of a capability. Canonical capabilities are the source for
installation.

**Overlay**:
A small harness-specific patch applied at install time when Claude Code and
Codex need different wording, metadata, or paths.

## Product Shape

```text
upstream sources
  -> committed snapshots
  -> source-native canonical skills/agents
  -> optional harness overlays
  -> copied install outputs for Claude Code and Codex
```

Capabilities are tracked first. Sources are metadata.

Example:

```yaml
sources:
  compound-engineering:
    kind: local-plugin
    version: 3.8.4
    path: capabilities/sources/compound-engineering

capabilities:
  - kind: skill
    source_name: ce-plan
    local_name: ce-plan
    source: compound-engineering
    upstream_path: skills/ce-plan
    canonical_path: capabilities/canonical/skills/ce-plan
    status: installed
    depends_on:
      - kind: agent
        name: ce-feasibility-reviewer
    risk:
      secret_bearing: false
      side_effecting: false
      networked: false
      writes_files: true
```

## Repository Layout

The v1 subsystem lives under `capabilities/`:

```text
capabilities/
  manifest.yml
  snapshots/
  canonical/
    skills/
    agents/
  overlays/
    claude-code/
    codex/
  scripts/
```

`capabilities/` has a hard boundary from prompt fragments and local hand-authored
skills. It may be extracted later if the lifecycle becomes painful inside this
repo.

## Accepted Decisions

1. The registry is capability-first and source-aware.
2. Upstream snapshots are committed to git.
3. Canonical adapted capabilities live separately from snapshots.
4. Installation copies files into target harness locations.
5. Canonical capabilities may have optional harness overlays.
6. Canonical content stays source-native by default.
7. Each capability has an explicit lifecycle status.
8. Manual dependency declarations are the source of truth; inferred dependency
   detection produces warnings.
9. Scripts, references, assets, and templates are parent-owned by default.
10. Capabilities use composable risk flags, not a single risk tier.
11. Install targets inherit global defaults with per-capability overrides.
12. Source names are preserved by default, with optional local aliases.
13. Aliases install as thin redirect wrappers.
14. Validation blocks high-confidence language leakage and warns on ambiguous
   cases.
15. V1 source types are Git repositories and local/plugin directories.
16. The registry starts inside `claude-code-config` under `capabilities/`.
17. The first installer is an isolated command under `capabilities/scripts/`.
18. `install.sh` integration is deferred until the standalone installer is
   proven.
19. This spec is the first durable artifact before implementation planning.

## Lifecycle Status

Each capability has one lifecycle status:

```text
draft      snapshot exists, not adapted
tracked    adapted canonical copy exists, not installed
installed  copied to one or more harness targets
retired    preserved for provenance, no longer installed
```

Status controls lifecycle. Risk flags control review posture.

## Risk Flags

Risk flags are composable:

```yaml
risk:
  secret_bearing: true
  side_effecting: true
  networked: true
  writes_files: true
```

Examples:

- `one-password`: `secret_bearing`
- `ce-commit-push-pr`: `side_effecting`, `networked`, `writes_files`
- `markdown-converter`: likely `writes_files`, maybe `networked` depending on mode
- `ce-plan`: `writes_files`

Validators may require stronger review gates for specific flags.

## Snapshots And Canonical Copies

Snapshots preserve upstream exactly enough to review later updates. Canonical
copies preserve useful upstream style while adapting only what Nathan needs.

```text
capabilities/snapshots/peter-agent-scripts/<commit>/skills/npm/
capabilities/canonical/skills/npm/
```

When upstream changes, the registry can compare:

```text
old upstream snapshot -> new upstream snapshot
old upstream snapshot -> Nathan canonical copy
Nathan canonical copy -> proposed promoted copy
```

Parent-owned scripts remain fully diffable because the parent skill folder is
snapshotted and canonicalized as a unit.

## Dependencies

Dependencies are declared manually:

```yaml
depends_on:
  - kind: agent
    name: ce-correctness-reviewer
  - kind: skill
    name: one-password
```

The validator may scan capability text for likely missing dependencies and warn:

```text
ce-code-review references ce-testing-reviewer but does not declare it.
```

Warnings do not rewrite the manifest automatically.

## Overlays

Most capabilities should install from canonical content unchanged. Overlays are
reserved for real harness edges, such as:

- Claude Code and Codex using different blocking-question mechanisms
- different agent metadata fields
- different install paths
- upstream source text naming a harness-specific runtime primitive

The rule is:

```text
canonical = source-native operating behavior
overlay = smallest possible harness-specific patch
```

## Install Targets

Install defaults are global and overridable:

```yaml
targets:
  default:
    claude-code: true
    codex: true

capabilities:
  - name: ce-plan
    install: default

  - name: codex-debugging
    install:
      claude-code: false
      codex: true
```

The first installer should be invoked directly:

```sh
./capabilities/scripts/install --target claude-code
./capabilities/scripts/install --target codex
```

`install.sh` can call this later once the standalone installer is proven.

## Aliases

Aliases are thin redirect wrappers, not duplicate full copies.

Example:

```text
canonical/skills/one-password/
installed alias: 1password -> one-password
```

The alias wrapper should only route discovery and invocation to the canonical
capability.

## Validation

Validation should check:

- manifest shape and required fields
- duplicate capability names and aliases
- missing snapshot or canonical paths
- malformed skill or agent frontmatter
- missing referenced files inside a capability folder
- undeclared likely dependencies
- unsafe secret-handling patterns
- high-confidence language leakage
- install target collisions

High-confidence leakage blocks installation. Ambiguous leakage warns.

Examples of high-confidence leakage:

- Peter-specific absolute paths in installed Nathan capabilities
- source-specific personal account names in generic capabilities
- `AskUserQuestion` in Codex-only output
- `request_user_input` in Claude Code-only output
- `~/.claude` paths in shared canonical text unless the capability is
  intentionally Claude-only

## Source Types

V1 supports:

- Git repositories
- local/plugin directories

This covers the first expected sources:

- Peter Steinberger's `steipete/agent-scripts`
- the Compound Engineering plugin cache

Raw URLs, package registries, and custom fetch adapters are out of scope for v1.

## Out Of Scope

- wholesale forking external repositories
- live-linking installed capabilities to upstream sources
- installing plugin MCP tools by copying plugin internals
- automatically promoting upstream changes into canonical copies
- replacing the prompt-fragment system
- general runtime policy management for every agent harness
- treating every bundled script as a separate first-class capability

## Open Questions

- What exact manifest schema should v1 use?
- What should the first source import set be?
- Which capabilities need Claude Code overlays on day one?
- What should the validator consider high-confidence secret leakage?
- How should update commands present three-way diffs without overwhelming the
  user?
- How should install collision handling behave when a local skill already exists
  outside the registry?
- Should retired capabilities remain installable by explicit command?
- Should the installer preserve executable bits for scripts, and how should that
  be validated?
- Should source snapshots include entire capability folders only, or also a
  source-level manifest snapshot?

## First Implementation Slice

The first build should be deliberately small:

1. Create `capabilities/manifest.yml`.
2. Snapshot one Peter skill and one Compound Engineering skill.
3. Create canonical copies for those capabilities.
4. Validate manifest shape, paths, frontmatter, dependencies, and obvious
   leakage.
5. Install copied outputs into a dry-run target before touching real harness
   directories.

Implementation planning should happen after this spec is reviewed.
