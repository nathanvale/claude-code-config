---
status: accepted
---

# Skillporter naming and source location

Skillporter source lives at `runtime/skill-porter/` in this repo (same tier as
`runtime/cli-command-facade`), workspace-linked to
`@side-quest/cli-command-facade` so it shares the facade, the catalog deps, and
the biome/tsc/bun proof harness without a publish step. It is a runtime product
CLI, not a skill, so it does not belong under `skills/`.

The published package is `@side-quest/skill-porter` (hyphenated, following the
`@side-quest/*` convention). The CLI binary is `skillporter` — a single word, no
alias — because the bin is typed daily and a single fluent word echoes
`mcporter` and minimises typing/ADHD friction; bin-shortens-package is the
common convention. The earlier placeholder `@side-quest/skill-port@0.0.0` is
retired.

## Considered options

- `@side-quest/skill-port` package + `skillport`/`skill-port` bin aliases —
  rejected: package stem ≠ spoken brand, and two near-identical aliases add
  cognitive load.
- bin `skill-porter` to mirror the package exactly — rejected: hyphen-in-bin
  buys nothing, breaks the `mcporter` echo at the moment of typing, and the
  bin-shortens-package convention favours the single word.
- Separate Side Quest repo — rejected for MVP: loses `workspace:*` facade
  linking and splits planning context from the docs; revisit if a real publish
  cadence demands independent versioning.

## Consequences

- Unscoped `skill-porter` and `skillporter` are intended squat-block parks
  (deprecated → scoped). As of this ADR the scoped package is published; the
  unscoped parks are still open.
- Docs, discovery metadata, and command examples use `skillporter` for the bin
  and `@side-quest/skill-porter` for the package.
