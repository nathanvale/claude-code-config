# Third-Party Skill Registry

Use for skills acquired from gogcli, Matt Pocock repositories, or another
external source.

## Registry

- Treat repository-root `skills-sources.yml` as the human-owned provider,
  immutable commit, and exact skill allowlist.
- Treat repository-root `skills-lock.json` as generated content-hash evidence;
  its `generatedFrom` field names the owning manifest and generator.
- Let `src/third-party-skills-cli.ts` fetch exact commits, generate the lock,
  invoke the pinned installer, and verify project/global copies.
- Keep acquired copies under `.agents/skills/` ignored.
- Never copy third-party skills into first-party `skills/`.
- Never hand-edit `skills-lock.json`.
- Keep reviewed upstream inventories and check timestamps in per-source local
  receipts under `~/.local/state/skills-sync/`.

## Add

1. Run `./setup catalog <skill-id>`; stop on a first-party collision.
2. Add the reviewed id under its provider in `skills-sources.yml`.
3. Pin the provider to the exact reviewed commit.
4. Preview lock generation:
   `bun run skills/skills-sync/src/third-party-skills-cli.ts lock --json`.
5. After review, generate:
   `bun run skills/skills-sync/src/third-party-skills-cli.ts lock --execute --json`.
6. Preview restore, then execute after approval:
   `bun run skills/skills-sync/src/third-party-skills-cli.ts restore --json`
   and
   `bun run skills/skills-sync/src/third-party-skills-cli.ts restore --execute --json`.

## Remove

1. Remove the reviewed id from `skills-sources.yml`.
2. Preview removal against the previous lock:
   `bun run skills/skills-sync/src/third-party-skills-cli.ts prune --json`.
3. Execute only when every listed target is expected:
   `bun run skills/skills-sync/src/third-party-skills-cli.ts prune --scope all --execute --json`.
4. Generate the new lock, then restore and check.

Prune removes only copies whose bytes match the previous lock. It checks all
targets before mutation, then rechecks each target immediately before removal.
Drift blocks the next removal; structured output reports exact partial progress.

## Restore

```bash
bun run skills/skills-sync/src/third-party-skills-cli.ts restore --json
bun run skills/skills-sync/src/third-party-skills-cli.ts restore --execute --json
bun run skills/skills-sync/src/third-party-skills-cli.ts check --json
./setup sync --check --json
```

Restore fetches each exact commit itself because `skills@1.5.14` cannot clone
commit SHA refs and its built-in restore does not enforce `computedHash`.

## Update

Resolve one candidate commit. Review changes for the exact allowlist, then
replace only that provider's `ref` in `skills-sources.yml`. Run the Add steps
from lock preview onward. Approval applies to that commit only.
