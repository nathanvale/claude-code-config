# Manifest

`docs/agents/doc-targets.yml` in the repo under audit. It answers one question per doc: **what would you have to read to check this?**

Without it the skill falls back to whole-repo lens scanning, which reads the top-level docs and misses everything a scanner would have to go looking for. On one real repo that gap was ~130 workflow claims across four docs — none of them read.

## Schema

```yaml
targets:
  <doc path>: [<artifact path>, ...]

unverifiable:
  <doc path>: <one-line reason>

frozen:
  - <glob>
```

**`targets`** — one entry per doc whose claims a repo artifact can settle. The listed artifacts are named in that agent's prompt, so it reads them instead of hunting. A doc absent from `targets` is scanned against the filesystem only.

**`unverifiable`** — docs whose claims no repo artifact can settle: external CLI behaviour, hosted CI runs, human-recorded receipts, third-party settings. These are **reported, never scanned**. The reason is quoted verbatim in the report.

**`frozen`** — records that are correctly stale. Superseded ADRs, historical plans. Skipped entirely.

## Why `unverifiable` is a tier and not an omission

A doc full of external-CLI claims returns zero findings whether it is accurate or wildly wrong. Reporting that as clean is the same failure the verification design exists to prevent: silence read as success. Naming these docs, with the reason, is the honest output. It also tells a reader where the real risk sits — the docs a repo cannot self-check are usually the ones that rot first.

## Worked example

`agent-plugin-template`, derived by auditing all 29 markdown files for claim density and verification target:

```yaml
targets:
  docs/publishing.md:
    - .github/workflows/release.yml
  docs/release-repair.md:
    - .github/workflows/release.yml
  docs/pull-requests-and-ci.md:
    - .github/workflows/plugin-ci.yml
    - .github/workflows/pull-request-title.yml
    - .github/workflows/release-impact.yml
    - .github/workflows/codex-review-gate.yml
  docs/adr/0003-reviewed-versioned-releases.md:
    - .github/workflows/release.yml
    - scripts/release-validate.ts
    - scripts/repository-readiness.ts
  docs/release-setup.md:
    - scripts/repository-readiness.ts
    - .github/workflows/hosted-canary.yml
  docs/adr/0005-shared-runtime-custody.md:
    - runtime/runtime.lock.json
    - runtime/skill-catalog.json
    - plugin/runtime/runtime-exec
  docs/adr/0007-workspace-authoring-bundled-distribution.md:
    - packages/skill-a/package.json
    - packages/skill-b/package.json
    - plugin/runtime/bundle-inventory.json
  docs/adr/0008-native-plugin-capability-tour.md:
    - plugin/hooks/native-capability-hook
    - plugin/hooks/claude/hooks.json
    - plugin/hooks/codex/hooks.json
  plugin/skills/capability-tour/SKILL.md:
    - runtime/skill-catalog.json
    - plugin/runtime/bundle-inventory.json
  plugin/skills/runtime-custody/SKILL.md:
    - plugin/runtime/runtime-exec
  plugin/THIRD-PARTY-NOTICES.md:
    - packages/skill-a/package.json
    - packages/skill-b/package.json
    - plugin/runtime/bundle-inventory.json
  AGENTS.md:
    - package.json
  README.md:
    - package.json
    - runtime/runtime.lock.json

unverifiable:
  docs/installing.md: external Claude and Codex CLI surface, flags, and JSON output shapes
  docs/canary-qualification.md: hosted CI run with real client installs
  docs/native-capability-qualification.md: human-recorded receipts from fresh client profiles
  CHANGELOG.md: PR numbers and compare URLs resolve only against the forge

frozen:
  - docs/adr/0002-*
  - docs/adr/0004-*
  - docs/plans/**
```

Note `docs/release-setup.md` appears in both `targets` and `unverifiable` in the audit's reading — its required-check *names* are greppable in `repository-readiness.ts`, while the GitHub settings state is not. When a doc splits that way, list it under `targets` and let the agent report the settings half as out of scope.

## Building one

Audit before writing. For each doc ask:

1. **How many checkable assertions?** Something that could be true or false about code, config, or workflows — not prose opinion. Claim density does not track file size: a 31-line runbook can carry ~28 claims while a 213-line superseded ADR carries none that are current.
2. **What settles them?** Name the exact artifact. "the code" is not a target; `.github/workflows/release.yml` is.
3. **Can anything in the repo settle them at all?** If not, it belongs in `unverifiable` with the reason.

Docs that narrate a workflow step by step, or restate a script's internal algorithm in prose, are the highest-value targets — they are dense, they drift with every workflow edit, and no generator keeps them honest.
