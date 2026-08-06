---
status: accepted
date: 2026-06-02
---

# Skill Prose Names Tools, CLIs Resolve Invocation

Skill bodies should name the external tool they need, such as `mcporter`, and avoid encoding package-runner choices such as `bunx`, `npx`, or `pnpm dlx` in the hot path. When a skill owns deterministic runtime tooling, that CLI owns command resolution and recovery: PATH first, explicit JSON-array command override when needed, no shell-string override, no automatic package-runner fallback, and structured missing-tool hints for agents.

This preserves lean, portable skill prose while keeping local setup deterministic. A user may satisfy the tool dependency with a global binary, PATH shim, package runner, or harness config; the public skill should not pick that for them.

## Scope

- Applies when a skill already owns deterministic runtime tooling.
- Does not require every skill to have a CLI.
- Does not ban local overlays from choosing `bunx`, `npx`, `pnpm dlx`, or a wrapper.

## Considered Options

- Put `bunx mcporter` in skill examples: simple locally, but makes a package runner look like public policy.
- Auto-fallback through package runners: convenient, but makes install/network/cache choices without explicit user setup.
- Shell-string override: familiar, but unsafe and ambiguous compared with command vectors.

## Consequences

- Skill prose stays Pete-lean: name the tool, not the runner.
- Runtime code becomes the review target for command resolution.
- Missing local tooling is a structured dependency failure, not browser entry repair or adapter fallback.
