---
date: 2026-06-16
topic: agent-skills-local-projection
---

# Agent Skills Local Projection Requirements

## Summary

Build a global CLI command that manages repo-local skill visibility through symlinks. The command reads the current repo config, applies an ignore list, and projects visible skills into local discovery folders. It does not install global skills.

---

## Problem Frame

The current skill install model creates global symlink state. That makes worktree testing confusing because an agent may see skills from main while the user is testing a branch. The new model should make the current repo or worktree the visibility boundary.

The user prefers an ADHD-friendly product shape: one clear mental model, one obvious status command, low hidden state, and a short repair path. Blacklist defaults are preferred because new skills should appear automatically, but the visible set must not become a black box when the catalog has dozens of skills.

Current repo evidence:

- `AGENTS.md` says skills are authored in `skills/`, while deploy targets can drift.
- `install.sh` currently links skills into global user locations.
- `docs/brainstorms/2026-05-30-agent-skills-repo-no-plugins-pivot.md` already points toward `.agents/skills/` as the repo-level projection target.
- `docs/ideation/2026-06-16-agent-skills-adhd-inventory-ideation.html` ranks the calm inventory ideas this requirements doc promotes.

---

## Key Decisions

- **Global command, local effect.** The executable may be available on `PATH`, but it reads and writes only the current repo unless a future feature explicitly says otherwise.
- **No global skills in v1.** The tool does not manage `~/.agents/skills`, `~/.claude/skills`, or `~/.codex/skills`.
- **Dual local projection roots.** V1 manages repo-local `.agents/skills/` and `.claude/skills/` so the shared convention and Claude both use the same repo boundary.
- **Symlink projector, not package manager.** The tool creates and removes local symlinks. It does not copy skills, resolve versions, publish plugins, or manage dependencies.
- **Obvious repo config.** V1 reads skill visibility settings from `.agent-skills.yml`.
- **Minimal config shape.** `.agent-skills.yml` uses top-level `catalog`, `ignore`, `projection_roots`, and `imports` keys.
- **Single catalog in v1.** The `catalog` key is one path string, not a list. Multiple catalogs are deferred because they imply precedence, duplicate-entry handling, and package-manager behavior.
- **Named external imports only.** The `imports` key is an explicit allowlist of CCC-owned Skill Catalog Entry ids symlinked into the configured catalog view; it is not a second catalog path or package manager.
- **Catalog-repo auto-default.** When `.agent-skills.yml` is absent and `./skills/` exists, v1 behaves as though `catalog: ./skills` and `ignore: []` were configured without creating the file.
- **Skill Catalog Entry ignore globs.** Ignore patterns match direct Skill Catalog Entry ids, such as `browser-*` or `fixture-*`, not filesystem paths like `skills/browser-use` or frontmatter `name` values.
- **Light validity bar.** V1 treats a catalog entry as valid when it is a direct child directory with `SKILL.md` and parseable frontmatter containing `name` and `description`.
- **Local snapshot state.** V1 stores the last projected state at `.agents/agent-skills-snapshot.json`; it is generated local state and should not be copied between worktrees.
- **Small snapshot contents.** The snapshot stores projected Skill Catalog Entry ids, resolved targets, and a projection timestamp; it does not copy `SKILL.md` metadata.
- **Generated projection roots.** `.agents/skills/`, `.claude/skills/`, and `.agents/agent-skills-snapshot.json` are generated local state, not git-tracked source.
- **Catalog-target managed links.** A projection symlink is managed when its resolved target is inside the current catalog; real directories and symlinks outside the catalog are unmanaged blockers.
- **Facade-backed CLI contract.** V1 should use the CLI command contract facade so discovery metadata, help, JSON output, human output, parser behavior, and runtime semantics cannot drift.
- **Dual audience output.** Human text is the default view; `--json` is the stable agent and script contract. Both surfaces must expose the same status meaning, repair action, and discoverability language.
- **Conservative ignore suggestions.** `ignore suggest` proposes broad noisy name prefixes only, such as `archive-*`, `experimental-*`, or `fixture-*`; it never applies suggestions automatically.
- **Split preflight path.** Humans start with `agent-skills status`; agents and CI use `agent-skills sync --check --json` as the decisive projection preflight.
- **Setup-friendly worktree support.** V1 does not create repo bootstrap scripts, but it should be easy for a repo-specific root `./setup.sh` to include `agent-skills sync --check --json` and route projection repair through `agent-skills sync`.
- **Startup fallback route.** Startup instructions may include a short fallback route: humans run `agent-skills status`; agents use `agent-skills sync --check --json`; repair usually goes through `agent-skills sync`. Detailed diagnostics stay in the CLI.
- **Default-open catalog.** All valid catalog skills are visible unless ignored by repo config.
- **Inventory explains the blacklist.** Blacklist behavior is acceptable only because `status`, `list`, and change summaries make the visible set legible.
- **One repair baton.** Broken projection state should produce one obvious next command, usually `agent-skills sync`.

---

## Ideation Capture

The requirements preserve all seven ranked ideas from `docs/ideation/2026-06-16-agent-skills-adhd-inventory-ideation.html`:

| Rank | Idea | Captured by |
|---|---|---|
| 1 | Status as a Calm Inventory Map | R31, R44-R51, R63-R68, F2, AE4 |
| 2 | New Since Last Sync | R35, R45-R47, AE5 |
| 3 | Skill Groups Without Profiles | Deferred for later |
| 4 | Explain Why Visible | R37, R61-R62, F4, AE6 |
| 5 | Ignore Suggestions | R38-R42, R50-R51, F3 |
| 6 | Repair Script That Says One Thing | R54-R58, R63-R64, AE7 |
| 7 | Attention Budget Preview | R48-R49 |

The requirements also preserve all rejected ideas as explicit v1 constraints:

| Cut idea | Captured by |
|---|---|
| Switch back to allowlist | R71 |
| Global user profiles | R72 |
| Interactive setup wizard | R73 |
| Automatic skill ranking by usage | R74 |
| Hard cap visible skills | R75 |
| Provider-specific dashboards | R76 |
| Detailed HTML report for status | R77 |

---

## Actors

- A1. **Repo user**: runs the CLI from a repo or worktree and wants agents to see the right skills.
- A2. **Planning or coding agent**: relies on repo-local skill discovery to find the intended skills for the current task.
- A3. **Skill catalog maintainer**: adds, renames, archives, or removes skills in the catalog.
- A4. **Reviewer**: checks whether the tool preserves the local-only contract and gives clear diagnostics.

---

## Requirements

**Source and projection model**

- R1. The canonical skill source remains the catalog directory, normally `skills/`; a valid catalog skill is a direct child directory with `SKILL.md` and parseable frontmatter containing `name` and `description`.
- R2. The CLI projects visible catalog skills into repo-local `.agents/skills/`.
- R3. The CLI projects visible catalog skills into repo-local `.claude/skills/`.
- R4. Projection entries are symlinks to catalog skill directories.
- R5. The CLI does not copy skill directories.
- R6. The CLI treats the current repo or worktree as the visibility boundary.
- R7. `.agents/skills/`, `.claude/skills/`, and `.agents/agent-skills-snapshot.json` are generated local state, not git-tracked source.
- R8. A projection symlink is managed when its resolved target is inside the current catalog.
- R9. Real directories inside projection roots are unmanaged blockers.
- R10. Symlinks whose resolved target is outside the current catalog are unmanaged blockers.
- R11. The CLI does not read, write, report, migrate, or clean `~/.codex/skills` in v1.
- R12. The CLI does not manage global user skill roots in v1, including `~/.agents/skills` and `~/.claude/skills`.

**Repo config and blacklist behavior**

- R13. The CLI reads `.agent-skills.yml` to find repo-local skill visibility settings.
- R14. The config supports top-level `catalog`, `ignore`, `projection_roots`, and `imports` keys; `catalog` is a single path string in v1.
- R15. The `ignore` key is a list of direct Skill Catalog Entry ids or glob patterns, not filesystem paths or frontmatter `name` values.
- R16. Skills are visible by default when they are valid catalog skills and do not match the ignore list.
- R17. Ignore rules subtract from the visible set; they do not define an allowlist.
- R18. New valid catalog skills become visible automatically unless ignored.
- R19. The config may identify an external catalog path for non-catalog repos.
- R19a. `projection_roots` lists repo-relative generated symlink roots; when omitted, v1 uses `.agents/skills` and `.claude/skills`.
- R19b. `imports` lists CCC-owned Skill Catalog Entry ids to symlink into the configured catalog view; omitted means no external imports.
- R20. In the catalog repo, the default catalog path is `./skills`.
- R21. When `.agent-skills.yml` is absent and `./skills/` exists, the CLI uses the catalog repo auto-default: `catalog: ./skills`, `ignore: []`, default `projection_roots`, and `imports: []`.

Minimal config example:

```yaml
catalog: ./skills
ignore:
  - experimental-*
projection_roots:
  - .agents/skills
  - .claude/skills
imports: []
```

**Commands**

- R22. The `agent-skills` CLI uses the CLI command contract facade.
- R23. Discovery metadata, rendered help, parser acceptance, JSON output, human output, and runtime semantics have alignment proof.
- R24. Human text is the default output mode.
- R25. `--json` is the stable agent and script output mode.
- R26. Human output and JSON output expose the same status meaning, repair action, and discoverability language.
- R27. `agent-skills sync` creates, updates, and removes local projection symlinks to match the current config; `agent-skills sync --check` previews the same changes without writing and exits `0` when clean, `1` when sync is needed, and `2` for invalid usage.
- R28. `agent-skills sync` updates `.agents/agent-skills-snapshot.json`.
- R29. The snapshot stores projected Skill Catalog Entry ids, resolved targets, and a projection timestamp.
- R30. The snapshot does not copy `SKILL.md` metadata.
- R31. `agent-skills status` shows the current repo, catalog, visible count, ignored count, projection health, change summary, checked roots, and one next action.
- R32. `agent-skills status --json` exposes the same status facts for agents and scripts; it is informational, while `agent-skills sync --check --json` is the projection gate.
- R33. `agent-skills list` shows the skill inventory in a calm, scan-friendly shape.
- R34. `agent-skills list --visible` shows only projected skills.
- R35. `agent-skills list --ignored` shows ignored skills and the matching ignore rule.
- R36. `agent-skills list --new` shows skills newly visible since the last sync snapshot.
- R37. `agent-skills list --why` explains why each listed skill is visible or ignored.
- R38. `agent-skills ignore add <pattern>` adds an ignore rule to repo config.
- R39. `agent-skills ignore remove <pattern>` removes an ignore rule from repo config.
- R40. Ignore write commands create or update only the supported v1 `.agent-skills.yml` shape; if existing config has unsupported shape, they fail with a repairable config error and do not rewrite it.
- R41. `agent-skills ignore list` prints configured ignore rules.
- R42. `agent-skills ignore suggest` suggests likely ignore patterns without applying them.
- R43. `agent-skills unlink` removes managed local projections for the current repo.

**Calm inventory**

- R44. `status` output fits under one screen for normal use.
- R45. `status` shows newly visible, removed, and newly ignored skills before the full inventory.
- R46. The snapshot used for change detection is local to the repo.
- R47. The snapshot is not the source of truth for visibility.
- R48. The tool labels the snapshot as the last projected state.
- R49. V1 does not group skills into buckets, profiles, or selectable presets.
- R50. The tool warns softly when the visible skill count is likely noisy.
- R51. The soft warning points to an inspection or ignore-suggestion command.
- R52. `status` makes the visible set understandable without inspecting symlink folders.
- R53. `status` names the local projection roots it checked.

**Repair and diagnostics**

- R54. Broken local projection state reports one primary repair command.
- R55. Verbose diagnostics are available behind an explicit flag.
- R56. Missing target skill directories are reported as broken projections.
- R57. Real directories inside projection roots are reported as unmanaged blockers.
- R58. Foreign symlinks inside projection roots are reported as unmanaged blockers.
- R59. When `agent-skills sync --check` finds an unmanaged blocker, it exits `1`, writes nothing, and reports `unmanaged_blocker` as the agent-visible outcome.
- R60. When any unmanaged blocker exists, `agent-skills sync` fails closed and writes nothing.
- R61. The tool explains whether a skill is hidden because it is ignored, invalid, missing, or outside the catalog.
- R62. The tool makes “why can’t the agent see this skill?” answerable from `status` or `list --why`.

**ADHD-friendly UX**

- R63. Every command should prefer one obvious next action over exhaustive prose.
- R64. The normal human path is `agent-skills status`, then `agent-skills sync` when repair is needed; the normal agent or CI preflight is `agent-skills sync --check --json`.
- R65. Command names use concrete verbs: `sync`, `status`, `list`, `ignore`, and `unlink`.
- R66. The tool avoids v1 concepts that imply hidden state, such as profiles, global installs, provider targets, or deployment modes.
- R67. Output should distinguish “available catalog,” “visible projection,” and “ignored exceptions.”
- R68. The CLI should be useful without reading documentation.
- R69. V1 does not create repo-specific root `./setup.sh` scripts, but it should be easy for those scripts to call `agent-skills sync --check --json` and route repair to `agent-skills sync`.
- R70. Startup instructions may carry a short fallback route for missing repo-local skills: humans run `agent-skills status`; agents use `agent-skills sync --check --json`; repair uses `agent-skills sync` when needed.

**Rejected ideation ideas captured as constraints**

- R71. V1 does not switch to allowlist mode.
- R72. V1 does not add global user profiles.
- R73. V1 does not add an interactive setup wizard.
- R74. V1 does not rank skills by usage.
- R75. V1 does not enforce a hard cap on visible skills.
- R76. V1 does not add provider-specific dashboards.
- R77. V1 does not make status a detailed HTML report.

---

## Key Flows

- F1. Local sync
  - **Trigger:** A1 runs `agent-skills sync` inside a repo.
  - **Steps:** Resolve repo root; read repo config; resolve catalog; apply ignore rules; plan projection changes; in default mode rewrite `.agents/skills/` and `.claude/skills/` managed symlinks and update the local snapshot; in `--check` mode report planned changes without writing.
  - **Outcome:** The repo-local discovery folders match the visible skill set.
  - **Covered by:** R1-R10, R13-R21, R27-R30, R46-R48

- F2. Calm status
  - **Trigger:** A1 runs `agent-skills status`.
  - **Steps:** Resolve repo and catalog; compute visible and ignored sets; compare with last snapshot; check projection health; print counts, changes, and one next action.
  - **Outcome:** A1 understands what agents can see without inspecting symlinks.
  - **Covered by:** R31-R32, R44-R53, R63-R68

- F3. Hide noisy skills
  - **Trigger:** A1 sees noisy skills or runs `agent-skills ignore suggest`.
  - **Steps:** The tool suggests likely ignore patterns; A1 adds a pattern; the tool updates repo config; A1 runs sync.
  - **Outcome:** The repo hides the noise while preserving default-open behavior.
  - **Covered by:** R15-R18, R38-R42, R50-R51

- F4. Explain visibility
  - **Trigger:** A1 wonders why an agent can or cannot see a skill.
  - **Steps:** A1 runs `agent-skills list --why`; the tool reports the visibility reason for each listed skill.
  - **Outcome:** The answer is local, inspectable, and does not require knowledge of global paths.
  - **Covered by:** R33-R37, R54-R62

- F5. Clean local projections
  - **Trigger:** A1 wants to remove this repo's managed skill projections.
  - **Steps:** A1 runs `agent-skills unlink`; the tool removes managed links in local projection roots and leaves unmanaged files alone.
  - **Outcome:** The repo has no managed skill projections.
  - **Covered by:** R4, R6-R10, R43, R57-R58

---

## Acceptance Examples

- AE1. **Covers R2-R4, R27.** Given `skills/fallow/SKILL.md` exists and is not ignored, when A1 runs `agent-skills sync`, then `.agents/skills/fallow` and `.claude/skills/fallow` are symlinks to the catalog skill.
- AE1a. **Covers R27.** Given projections are out of date, when A1 runs `agent-skills sync --check`, then the output reports planned changes, exits `1`, and does not change projection roots or snapshot state.
- AE2. **Covers R11-R12.** Given global skill folders exist, when A1 runs any v1 command, then the command does not read, write, clean, or report those folders.
- AE3. **Covers R15-R18, R27.** Given config ignores `experimental-*`, when sync runs, then matching skills are absent from local projections and non-ignored skills remain visible.
- AE4. **Covers R31, R44-R45.** Given 58 catalog skills and 8 ignored skills, when A1 runs `status`, then the output shows visible and ignored counts, changes since last sync, projection health, and one next action.
- AE5. **Covers R36, R46-R48.** Given `worktree` was added after the last sync, when A1 runs `list --new`, then the output shows `worktree` as newly visible and does not require scanning the full inventory.
- AE6. **Covers R37, R61-R62.** Given `fallow` is ignored by config, when A1 runs `list --why fallow`, then the output names the matching ignore rule as the reason.
- AE7. **Covers R31, R54-R58.** Given `.agents/skills/fallow` points nowhere, when A1 runs `status`, then the output names the broken projection and gives `agent-skills sync` as the primary repair command.
- AE8. **Covers R22-R26.** Given v1 is implemented, when a reviewer checks the CLI surface, then command discovery metadata, help, human output, JSON output, parser behavior, and runtime semantics stay aligned.
- AE9. **Covers R7, R28-R30.** Given a new worktree is created from git, when it starts with no local projection state, then `agent-skills status` reports no last projected state and `agent-skills sync` creates the projection roots and snapshot locally.
- AE10. **Covers R71-R77.** Given v1 is implemented, when a reviewer checks the command surface, then there are no profiles, global install commands, usage ranking, hard caps, provider dashboards, or HTML status reports.

---

## Success Criteria

- S1. A user can explain the model as: global command, local config, local projections, no global skills.
- S2. A worktree can expose branch-local skill changes without merging to main.
- S3. A user can answer “what skills are visible here?” from one command.
- S4. A user can answer “what changed since last sync?” without reading the whole catalog.
- S5. A user can hide noisy skills through a blacklist without maintaining an allowlist.
- S6. Broken projection state gives one recovery command.
- S7. Planning can implement the feature without inventing product behavior.

---

## Scope Boundaries

Deferred for later:

- User-global publication or stable daily install.
- Team catalog distribution.
- Skill grouping without profiles.
- Skill category metadata in frontmatter.
- Usage analytics or ranking.
- Rich UI beyond CLI output.

Outside v1 identity:

- Package manager behavior.
- Plugin marketplace behavior.
- Version solving.
- Dependency management.
- Global skill ownership.
- Provider-specific dashboards.
- Automatic skill curation that hides skills without user config.

---

## Dependencies / Assumptions

- D1. Codex can discover repo-local `.agents/skills/`.
- D2. Claude can discover repo-local `.claude/skills/`.
- D3. The repo continues to treat `skills/` as the authoring source.
- D4. The command can safely distinguish managed symlinks from unmanaged files.
- D5. A small local snapshot file is acceptable for change awareness if it is clearly not source of truth.
- D6. Existing global skill links may remain on disk, but v1 does not manage them.
- D7. Generated projection state, including `.agents/agent-skills-snapshot.json`, is local operational state and should be ignored rather than copied through git worktree checkout.
- D8. Current tracked `.agents/skills` links are old-model state; v1 migration should remove them from git tracking and let `agent-skills sync` regenerate them locally.

---

## Worktree And Startup Notes

- Repo-specific root `./setup.sh` is outside v1 implementation scope, but worktree support should mention it as the intended place to call `agent-skills sync --check --json` and route projection repair to `agent-skills sync`.
- Startup instructions may carry a short fallback route for missing repo-local skills: humans run `agent-skills status`; agents use `agent-skills sync --check --json`; repair uses `agent-skills sync` when needed. The CLI owns exact diagnostics and repair output.

---

## Sources / Research

- `docs/ideation/2026-06-16-agent-skills-adhd-inventory-ideation.html`
- `AGENTS.md`
- `install.sh`
- `docs/brainstorms/2026-05-30-agent-skills-repo-no-plugins-pivot.md`
- `skills/adhd-helper/SKILL.md`
- `skills/create-cli/SKILL.md`
- `skills/create-cli/references/agent-native-cli-design.md`
- `skills/create-cli/references/cli-command-facade.md`
- OpenAI Codex skills documentation: `https://developers.openai.com/codex/skills`
- Claude skills documentation: `https://code.claude.com/docs/en/skills`
- Matt Pocock skills repository: `https://github.com/mattpocock/skills`
