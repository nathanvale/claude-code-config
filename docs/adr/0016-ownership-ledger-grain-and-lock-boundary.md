---
status: accepted
---

# Ownership Ledger is a separate file keyed by (target, skillName)

Skillporter keeps its own Ownership Ledger file as the single authority for
Skillport-managed ownership. The provider's `skills-lock.json` is read-only
input: Skillporter reconciles against it on read (using its `source`,
`sourceType`, `computedHash`) but never writes it, because the provider owns the
lock and a second writer would drift.

Each ledger record is keyed by the tuple `(target, skillName)`, with `source`,
`providerId`, `computedHash`, and `managedAt` as fields. Presence of a record
*is* the "Skillport manages this (skill, target)" fact — there is no separate
managed-by flag.

**Storage location:** the ledger is durable user data, not repo state and not
disposable runtime state, so it lives under `$XDG_DATA_HOME`
(`~/.local/share/skillporter/ledger.json`, dir `0700` / file `0600`). It is the
canonical truth Skillporter cannot rebuild from anything else. Contrast the
disposable plan artifact, which lives under `$XDG_STATE_HOME` (see ADR-0017).

**Schema ownership:** the field list above is intent, not the contract. The
exact record type and its validator are code-owned in `runtime/skill-porter/`
(a closed type plus a read/parse validator), so the fields cannot drift from a
prose table. This ADR names the decision; the code owns the shape.

## Why this grain

- **Target in the key:** one add can install a skill to multiple targets (e.g.
  `codex` and `claude-code`) and must record ownership per target. The lock is
  keyed by skill name only and physically cannot express this.
- **Source as a field, not in the key:** the foreign-same-name block fires when
  `(target, skillName)` collides but the existing `source` differs. If source
  were in the key, a foreign install would be a different key and the collision
  would be invisible.
- **Presence = ownership:** a human-placed skill has no ledger record, so
  removal blocks with no extra flag needed; the ledger only ever contains
  Skillport-managed installs.

## Consequences

- A foreign same-name install lives in the provider lock, not the ledger, so the
  pre-add gate must check **both**: lock reconciliation for foreign-occupied
  slots, and the ledger for Skillport ownership.
- **Pre-add read is a hybrid (verified against `/vercel-labs/skills`):** the
  provider's public `skills list --agent <id> --json` returns only
  `name/path/scope/agents` — it omits `source`. So occupancy and per-target view
  come from `list --json`, but the `source` attribution AE2 needs comes only
  from reading `skills-lock.json`. Reading the lock is therefore mandatory, not
  optional convenience.
- The lock read must tolerate format drift: the locally observed shape is
  object-keyed (`{version, skills: {name: {source, sourceType, skillPath,
  computedHash}}}`, provider v1.5.11) while upstream docs show an array shape
  (`{skills: [{name, source, agents, hash}]}`). The adapter normalises both and
  treats the read as best-effort for `source`.
- Both reads live behind the Skills Provider adapter so a provider/lock-format
  change has a one-file blast radius.
- Storage is nested `target → skillName → record` for O(1) block and status
  lookups rather than a flat scanned list.

## Considered options

- Write a Skillport namespace into `skills-lock.json` — rejected: two writers,
  fragile to provider lock-format changes, forks a provider-owned artifact.
- Derive ownership at runtime from the lock's `source` with no persisted ledger
  — rejected: the lock has no per-target dimension and no managed-by-Skillport
  signal, so human-owned vs Skillport-owned on the same target is
  inexpressible.
