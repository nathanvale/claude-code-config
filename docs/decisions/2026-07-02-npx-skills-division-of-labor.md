---
title: npx skills and agent-skills Division of Labor Decision Log
slug: npx-skills-division-of-labor
type: decision-log
status: accepted
date: "2026-07-02"
timezone: Australia/Melbourne
owner: agent-skills
source:
  - runtime/agent-skills/docs/plans/2026-07-02-002-feat-npx-skills-division-of-labor-plan.md
  - docs/adr/0016-ownership-ledger-grain-and-lock-boundary.md
  - runtime/agent-skills/docs/brainstorms/2026-06-16-agent-skills-local-projection-requirements.md
decision_metadata_format: fenced-yaml-per-decision
---

# npx skills and agent-skills Division of Labor Decision Log

Use this log for accepted decisions about how the community `skills` CLI
(`npx skills` / skills.sh) and `runtime/agent-skills` share `.agents/skills/`.

## Frame

- `npx skills` is a package manager: hash-pinned copies of external skills,
  recorded in a git-trackable `skills-lock.json`, deduped into agent dirs via
  canonical-copy symlinks.
- `agent-skills` is a projector: live symlinks from the repo's own `skills/`
  catalog into the same roots.
- Before this decision, every npx-skills install was an `unmanaged_blocker`
  that wedged `agent-skills sync`.

## Decision 1: Split Acquisition From Projection

```yaml
id: npx-skills-division-001
status: accepted
decided_at: "2026-07-02"
decision: npx skills owns external skill acquisition; agent-skills owns repo-local live projection; agent-skills recognizes lockfile-managed entries as a third external class
owner: agent-skills
source:
  - runtime/agent-skills/docs/plans/2026-07-02-002-feat-npx-skills-division-of-labor-plan.md
```

Decision:

- External skill acquisition (install, pin, update, remove) belongs to the
  community `skills` CLI, invoked as `bunx skills ...`.
- Repo-local visibility of the repo's own catalog belongs to `agent-skills`.
- `agent-skills` classifies projection-root entries whose id appears in
  `skills-lock.json` as `external`: never created, modified, or removed by
  `sync` or `unlink`; excluded from health.
- Entries not in the lockfile keep full fail-closed blocker behavior.
- A catalog id colliding with a lock id fails closed as a `catalog_conflict`
  blocker naming both sources and the two repair options (rename the catalog
  skill id, or remove the external install with the skills CLI).

Rationale:

- Two tools, two verbs; wrapping one inside the other duplicates a package
  manager badly (the retired `imports:` feature proved this).
- Recognition-not-ownership reuses Skillporter's lock-boundary rule (ADR 0016)
  minus the ledger, which only a mutating installer needs.

Consequences:

- `external` joins `visible`/`ignored`/`invalid` in the domain vocabulary with
  its own status count; blockers stay blockers (ADR 0018 layering preserved).
- The lock reader (`runtime/agent-skills/src/skills-lock.ts`) is read-only,
  tolerates both observed lock shapes, validates keys as single
  path-component tokens, and degrades malformed input to empty plus a named
  parse-failure diagnostic.

## Decision 2: Lock Tracked, Copies Ignored

```yaml
id: npx-skills-division-002
status: accepted
decided_at: "2026-07-02"
decision: Commit skills-lock.json; keep installed copies gitignored; fresh worktrees restore with bunx skills experimental_install
owner: agent-skills
```

Decision:

- `skills-lock.json` is git-tracked at the repo root.
- Installed copies under `.agents/skills/` stay gitignored (node_modules
  model).
- Fresh clones/worktrees restore external skills with
  `bunx skills experimental_install`; `agent-skills status` counts missing
  externals and names that restore hint.
- Scripted gates pin the provider (`bunx skills@1.5.14`) — the version all
  behavioral claims were verified against; `experimental_install` is a
  provider-experimental surface, and the pinned form is the fallback when
  latest breaks.

Rationale:

- Consistent with the repo's generated-state philosophy; avoids committing
  third-party copies.
- Floating to latest would let an upstream release silently change `--list`
  output or lock shape under a Definition-of-Done gate.

## Decision 3: Remove `imports:` Outright

```yaml
id: npx-skills-division-003
status: accepted
decided_at: "2026-07-02"
decision: Remove the imports feature with no deprecation window; a config containing imports fails with a repairable error naming bunx skills add
owner: agent-skills
```

Decision:

- The `imports:` config key, bundled-catalog symlinking, and stale-import
  cleanup are deleted from `agent-skills`.
- A config containing `imports:` fails with `invalid_config` whose message
  names `bunx skills add <source> -s <skill>` as the replacement — this
  repairable error is the migration path.

Rationale:

- npx skills is better for acquisition: any source, hash pin, update path.
- No production config in this repo used `imports:` at removal time; consumer
  repos are covered by the migration error, not an absence claim.

Consequences:

- **Accepted dev-loop regression:** `imports:` did one thing copies cannot —
  live cross-repo projection of an edited CCC skill. That loop regresses to a
  `skills update` re-copy until an upstream `--link` live-symlink mode lands
  (feature request to `vercel-labs/skills` is deferred follow-up work).

## Decision 4: Accepted Hazards And Open Threads

```yaml
id: npx-skills-division-004
status: accepted
decided_at: "2026-07-02"
decision: Accept the pre-install overwrite hazard with a startup guard; record the provider hash-verification gap and the ADR 0011 global-topology thread as open
owner: agent-skills
```

Decision:

- **Pre-install overwrite hazard (accepted, guarded):** raw `skills add`
  overwrites a same-name skill from a different source, and `agent-skills`
  detects the collision only after the fact. Guard: the AGENTS.md route says
  to check the id against `agent-skills status` before `bunx skills add`.
- **Skillporter deferred:** the plan-before-mutation shell (ADRs 0015-0018)
  is not built; direct `bunx skills` usage plus projector recognition
  replaces it for now. ADR 0015 carries the supersession note.
- **Open integrity gap:** whether any provider surface verifies
  `computedHash` against disk post-install is unverified; `agent-skills`
  surfaces a tamper-visibility note for external real dirs whose lock record
  has no hash, but content-hash drift detection is deferred.
- **Open thread:** reconciling ADR 0011's global `install.sh` deploy topology
  with the repo-local projector is a separate future decision.

Rationale:

- The overwrite hazard was proven by the Skillporter prototype; a startup
  guard is the cheapest mitigation that does not rebuild Skillporter.
- Recording gaps beats assuming the provider covers them.
