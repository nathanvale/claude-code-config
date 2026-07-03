---
title: Agent Skills Projection Hardening Decision Log
slug: agent-skills-projection-hardening
type: decision-log
status: accepted
date: "2026-07-03"
timezone: Australia/Melbourne
owner: agent-skills
source:
  - runtime/agent-skills/src/projection.ts
  - runtime/agent-skills/src/skills-lock.ts
  - docs/decisions/2026-07-02-npx-skills-division-of-labor.md
decision_metadata_format: fenced-yaml-per-decision
---

# Agent Skills Projection Hardening Decision Log

An adversarial audit (7 finder lenses + refute-by-default verification, live
probes against `bunx skills@1.5.14` on a case-insensitive APFS volume) surfaced
20 verified findings in the projection + external-lock classifier. This log
records what shipped, what became tracked follow-up, and why.

## Context

The projector shares `.agents/skills` and `.claude/skills` with the community
`skills` CLI and, in some repos, a hand-rolled projector
(`experience-sdk/scripts/install-skills.sh`). Entries land via six pathways:
`agent-skills sync`, `bunx skills add`, `experimental_install`, the global
`install.sh`, the experience-sdk script, and manual drops. The classifier keyed
ownership on exact-string ids and trusted a plan snapshot through to apply. The
audit showed both assumptions break.

## Decisions

```yaml
id: canonical-id-fold
status: accepted
findings: [1, 2, 10]
severity: high
```

Fold every id to a case-folded, NFC-normalized key (`canonicalSkillId`) before
any lock lookup or catalog-conflict comparison. Case-insensitive volumes
(macOS/Windows) and Unicode normalization collapse `Fallow`/`fallow` and
NFC/NFD variants to one filesystem path; exact-string map keys let a variant
lock id evade `catalog_conflict` while its planted directory classified as an
untouchable `external`. Both sides now fold identically, so a variant id cannot
diverge. Raw ids are kept for display.

```yaml
id: catalog-conflict-visible-only
status: accepted
findings: [6, 7]
severity: medium
```

`catalog_conflict` fires only for `visible` catalog entries. An ignored or
invalid catalog directory sharing a lock id is not a projection candidate and
must not wedge sync. This restores the ignore escape hatch and stops a
half-written catalog dir from blocking all sync.

```yaml
id: benign-self-install
status: accepted
findings: [4, 5]
severity: high
```

A lock entry whose `sourceType` is `local` and whose `source` resolves into the
catalog root is a benign self-install (the community CLI recorded the repo's own
catalog skills). Such ids alias catalog ids: they never raise `catalog_conflict`
and their disk copies classify managed, not external. This makes agent-skills
usable in the experience-sdk topology, which previously wedged with 178
self-contradictory blockers.

```yaml
id: apply-time-revalidation
status: accepted
findings: [2, 11, 12, 13, 17]
severity: high
```

`applyProjection` re-reads the lock and re-classifies each path immediately
before mutating. It never `rm`s a real directory (only symlinks or absent
paths), which removes both the non-recursive-`rm` crash and the risk of
deleting a concurrently-landed external. Any mid-apply ownership surprise fails
closed (`unmanaged_blocker`) so the caller re-plans against current disk state
instead of forcing a stale write.

```yaml
id: classifier-ordering-and-escape-guards
status: accepted
findings: [3, 8, 9, 14]
severity: high
```

Two ordering rules: (1) a catalog entry whose realpath escapes the catalog is
blocked on the catalog side, never projected as an escaping link the next plan
would condemn; (2) a symlink resolving or raw-pointing into the catalog is a
tool-owned artifact and classifies managed/broken before lock recognition, so
`unlink` and `sync` keep their escape hatch even when a lock entry later claims
the id.

```yaml
id: lstat-tolerance
status: accepted
findings: [16]
severity: low
```

`readProjectionRoot` tolerates a child vanishing between `readdir` and `lstat`
(concurrent skills CLI, git checkout): skip the entry instead of rejecting the
whole plan.

## V2 audit amendments

```yaml
id: canonical-id-full-fold
status: accepted
findings: [4, 10]
severity: high
```

`canonicalSkillId` uses compatibility-aware folding, not simple lowercase:
NFKC, lowercase, ß to `ss`, final sigma to sigma, then NFC. Ignore glob matching
uses the same fold for both pattern and id, so folded catalog conflicts can be
suppressed by the documented ignore escape hatch.

```yaml
id: benign-self-install-id-binding
status: accepted
findings: [1, 3]
severity: critical
```

Benign self-install requires `sourceType: local` and a `source` realpath equal
to the catalog entry for the same id. A local source that points at the catalog
root or a different catalog id is external evidence, not a conflict suppressor.
Projection-root real directories or foreign symlinks with lock records classify
external unless they are already tool-owned links into the catalog; `unlink`
removes only such links.

```yaml
id: projection-root-realpath-boundary
status: accepted
findings: [2]
severity: critical
```

Every projection root is resolved through its existing path chain before read,
write, or unlink. A root or existing parent that realpaths outside the repo
becomes a `foreign_symlink` blocker, and mutating paths throw
`unmanaged_blocker` instead of following the escape.

```yaml
id: apply-syscall-surprises-fail-closed
status: accepted
findings: [5, 7, 9]
severity: high
```

Apply-time link removal now proves the symlink resolves or raw-points into the
catalog target set before deleting it. `rm` and `symlink` syscall errors defer
the path and end in `unmanaged_blocker`, preserving post-plan foreign symlinks
and avoiding raw OS-error crashes after partial mutation.

```yaml
id: lock-parse-failure-blocker-why
status: accepted
findings: [6]
severity: high
```

When a present lock cannot be parsed, record-less blockers include a `why` that
names `skills-lock.json` and directs repair at the lockfile before deleting
projection entries that may be external installs.

```yaml
id: unlink-fold-parity
status: accepted
findings: [8, 11]
severity: medium
```

`unlinkManagedProjections` uses the same canonical lock map as status and sync.
It reads only repo-bound projection roots and returns/removes managed or broken
symlinks, so variant lock ids no longer make the unlink lane silently diverge
from status.

## Deferred, tracked in TASKS.md

```yaml
id: external-hash-verification
status: deferred
findings: [15]
```

agent-skills does not re-hash externals against `computedHash`. Emitting a
drift boolean would require matching the provider's exact hash algorithm;
guessing risks false positives that erode trust in the signal. Recorded as a
documented gap (`has_hash` reports only presence) and a P2 task to decide
whether agent-skills verifies or names the provider surface that does.

```yaml
id: non-destructive-blocker-affordance
status: deferred
findings: [18]
```

A `real_entry`/`foreign_symlink` blocker dead-ends an autonomous agent at
`inspect_blocker`; the only unwedge move is `rm`, which destroys provenance. A
non-destructive verb (adopt/quarantine/ignore) is a CLI-contract addition
needing `cli-author` design, tracked P2.

```yaml
id: agent-skills-sibling-tree
status: documented
findings: [19]
```

`bunx skills add ... -a '*'` can write a non-hidden `agent/skills/<id>` tree
outside the two projection roots. agent-skills never scans or manages it;
`bunx skills remove` owns cleanup. Documented in README scope notes, no code
change.

```yaml
id: pre-install-collision-guard
status: accepted
findings: [20]
```

The `AGENTS.md` pre-install guard pointed at `agent-skills status`, which cannot
detect a same-name collision before install (the lock entry does not exist
yet). Reworded to check `agent-skills list` (catalog inventory) first; `status`
only flags the collision after install.

## Verification

89 package tests pass after the v2 amendments, typecheck clean, and lint clean.
Regressions cover: case/Unicode-variant conflict and ignore matching,
ignored/invalid catalog collision, id-bound benign self-install, escaped
projection roots, tool-owned link removability, unlink self-install real-dir
safety, lock-parse blocker `why`, and apply-time fail-closed behavior for
post-plan real dirs, foreign symlinks, and syscall surprises.
