# Agent Skills

Repo-local skill projection runtime: one skill catalog projected as managed
symlinks into agent runtime roots, with fail-closed sync and agent-readable
JSON envelopes.

Current source map:

- v1 local projection: `runtime/agent-skills/docs/plans/2026-06-16-001-feat-agent-skills-local-projection-plan.md`.
- External lock recognition and imports retirement: `runtime/agent-skills/docs/plans/2026-07-02-002-feat-npx-skills-division-of-labor-plan.md`.
- Division-of-labor decisions: `docs/decisions/2026-07-02-npx-skills-division-of-labor.md`.

## Language

**Skill catalog**:
The source directory of skills that agent-skills projects, default `./skills`.
Catalog entries are direct child directories; the catalog is source, never
generated state.
_Avoid_: marketplace, plugin registry, install target, projection root

**Catalog entry**:
One direct child directory of the catalog, identified by its directory id.
Validity requires a skill file with parseable frontmatter; invalid entries
carry a repairable reason (`missing_skill_file`, `invalid_frontmatter`).
_Avoid_: skill package, nested path, frontmatter name as id

**Projection root**:
A repo-relative directory that receives generated local runtime views, default
`.agents/skills` and `.claude/skills`. Absolute and `..` roots are rejected.
_Avoid_: catalog, source dir, global skills folder, deploy target

**Managed projection link**:
A symlink inside a projection root that resolves into the configured catalog.
Sync creates, repairs, and removes only these; everything else is external or
a blocker.
_Avoid_: copy, install, foreign symlink, unmanaged entry

**Broken managed link**:
A managed symlink whose target is stale or dangling but whose raw path still
points into the configured catalog. Broken links are repairable by sync,
reported as the `broken` change category and the `broken` health value, and
are never blockers.
_Avoid_: foreign symlink, blocker, external entry

**Projector**:
agent-skills' role in the division of labor: live-symlink the repo's own
catalog into projection roots so worktree edits are instantly visible. The
community `skills` CLI is the package manager for external acquisition.
_Avoid_: package manager, installer, updater, marketplace client

**External entry**:
A projection-root entry whose id appears in the repo's `skills-lock.json`.
Externals are counted by `status`, explained by `list --why`, and never
created, modified, or removed by `sync` or `unlink`. Each external carries an
informational disk shape, `real_entry` or `symlink`; the shape reuses the
`real_entry` spelling from the blocker vocabulary but never makes an external
a blocker.
_Avoid_: unmanaged blocker, catalog entry, agent-skills-owned link

**Skills lock**:
The git-tracked `skills-lock.json` written by the community `skills` CLI.
agent-skills reads it as read-only input; a second writer would drift
(ADR 0016). Lock keys are validated as single path-component tokens before
entering the external set.
_Avoid_: agent-skills state, snapshot, writable config

**Lock parse failure**:
The named diagnostic when `skills-lock.json` is present but unreadable, or its
raw records yield zero valid ids. A validly empty lock is not a parse failure.
Classification degrades to no external entries so triage points at the
lockfile, not at deleting entries.
_Avoid_: crash, silent empty, blocker, validly empty lock

**Missing external**:
A lock id with no disk entry in any projection root. Informational count with
the restore hint (`bunx skills experimental_install`), never a blocker or
health failure.
_Avoid_: broken link, unmanaged entry, sync candidate

**Blocker**:
An entry that stops sync from writing: `real_entry` (real file or directory
where a managed link would go), `foreign_symlink` (points outside the
catalog), or `catalog_conflict` (catalog id collides with a lock id). The CLI
never deletes blockers; repair changes config or moves source.
_Avoid_: error string, external entry, auto-fixable state

**Fail-closed sync**:
The write stance: sync refuses all writes while blockers exist, and external
recognition must not weaken this for non-lockfile entries.
_Avoid_: best-effort sync, partial write, force flag

**Snapshot**:
The generated `.agents/agent-skills-snapshot.json` persisted after a
successful sync: projected ids, targets, and timestamp. It powers
newly-visible and removed-since-snapshot summaries and belongs outside git.
_Avoid_: lockfile, config, source of truth

**Projection health**:
The status classification of projection state: `clean`, `needs_sync`,
`broken`, or `blocked`.
_Avoid_: station, exit code, test result

**Station**:
The agent-visible runtime outcome from the Branch Station vocabulary:
`clean`, `needs_sync`, `synced`, `unmanaged_blocker`, `invalid_config`,
`invalid_usage`. Stations name deterministic command outcomes tests can prove.
_Avoid_: health, log line, freeform status

**Branch Station Catalog**:
The package-owned command-branch coverage map in
`runtime/agent-skills/src/branch-station-catalog.ts`. It names deterministic
public command paths without copying the CLI implementation.
_Avoid_: task tracker, manual checklist, runtime log

**Visibility**:
The per-entry classification behind `list`: `visible`, `ignored`, `invalid`,
or `external`, each with an inspectable reason for `list --why`.
_Avoid_: enabled/disabled, health, install state

**Ignore rule**:
A config glob matched against whole direct catalog-entry ids to hide entries
from projection. Rules never match paths, nested files, or frontmatter names.
_Avoid_: gitignore, path filter, frontmatter filter

**Catalog-repo auto-default**:
The zero-config behavior when `.agent-skills.yml` is absent but `./skills`
exists: catalog `./skills`, roots `.agents/skills` and `.claude/skills`. Both
absent returns `missing_config`.
_Avoid_: hidden global config, guessed catalog, implicit write

**Imports migration error**:
The repairable `invalid_config` failure when a config still contains
`imports:`. The message names `bunx skills add <source> -s <skill>` as the
replacement; the feature is removed, not deprecated.
_Avoid_: silent ignore, legacy support, soft warning

**Next action**:
The single package-owned recommendation in every status result: `none`,
`sync`, `inspect_blocker`, or `fix_config`, plus a one-line summary. Agents
follow it instead of inferring repair from raw fields.
_Avoid_: instruction list, freeform advice, exit code, failure action

**Failure action**:
The `action` field on CLI failure envelopes: `help`, `fix_config`,
`inspect_blocker`, or `inspect_error`, rendered with the same `next:` label
as status next actions. It is facade-error vocabulary, not the status Next
action; only `fix_config` and `inspect_blocker` overlap the two enums.
_Avoid_: next action, status field, exit code

**Noise hint**:
The soft warning added when the visible set exceeds the noise threshold (40).
Guidance to inspect ignore rules, not a failure.
_Avoid_: blocker, error, hard cap

**Command facade contract**:
The CLI Interface in `runtime/agent-skills/src/command-contract.ts` that owns
command discovery, help metadata, parser rules, result contracts, and exit
codes. Docs point to it instead of copying flags or schemas.
_Avoid_: docs schema, README copy, help prose

**Source-linked bin**:
The temporary local-consumption contract (`sideQuest.sourceLinkedBin`) that
lets this private package expose an `npm link`-ed bin while the workspace
facade check keeps rejecting accidental private bins elsewhere.
_Avoid_: published package, permanent contract, global install
