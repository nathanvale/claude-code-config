# Matt Pocock Skills

Use for selected skills from `https://github.com/mattpocock/skills`.

## Ownership

- Selected set and immutable commit: repository-root `skills-sources.yml`.
- Generated hashes: repository-root `skills-lock.json`.
- Acquisition and verification:
  `skills/skills-sync/src/third-party-skills-cli.ts`.
- Global Claude Code and Codex visibility: provider-managed user projections.
- Monthly receipt:
  `~/.local/state/skills-sync/mattpocock-skills-check.json`.

The `mattpocock/skills` allowlist is the selected set. Absence means
unselected.

## Selected Baseline

- `ask-matt`
- `codebase-design`
- `diagnosing-bugs`
- `domain-modeling`
- `grill-me`
- `grill-with-docs`
- `grilling`
- `handoff`
- `implement`
- `improve-codebase-architecture`
- `prototype`
- `setup-matt-pocock-skills`
- `tdd`
- `teach`
- `to-questionnaire`
- `to-spec`
- `to-tickets`
- `triage`
- `wait-what`
- `wayfinder`
- `writing-for-agents`

`grilling`, `codebase-design`, and `domain-modeling` are upstream dependencies.
`handoff` and `triage` use upstream behavior; their former local variants remain
under `skills/archive/`. `setup-matt-pocock-skills` is selected for per-repo
configuration.

## Install

Preflight every selected id through `./setup catalog <id>`. Remove or rename a
first-party owner before acquisition.

Pin the exact reviewed commit and selected ids in `skills-sources.yml`, then:

```bash
bun run skills/skills-sync/src/third-party-skills-cli.ts lock --json
bun run skills/skills-sync/src/third-party-skills-cli.ts lock --execute --json
bun run skills/skills-sync/src/third-party-skills-cli.ts restore --json
bun run skills/skills-sync/src/third-party-skills-cli.ts restore --execute --json
./setup sync --check --json
```

## Monthly Gate

Run during skills-sync when the receipt is absent, invalid, or at least 30 days
old. A skill run is the scheduler; do not claim a background check.

1. Read selected ids and current commit from the `mattpocock/skills` provider
   in `skills-sources.yml`.
2. Read upstream `package.json`, `CHANGELOG.md`, HEAD commit, and published
   skill list.
3. Compare the published list with `seen_skill_ids` in the prior receipt.
4. Report newly published ids once. Present category, description, collision
   result from `./setup catalog <id>`, and a recommended default.
5. Report selected ids removed or renamed upstream as blockers.
6. Summarize changelog changes affecting selected ids.
7. Ask before updating selected skills or adding newly reviewed skills.
8. Write the receipt only after upstream lookup and comparison succeed.

Do not repeatedly prompt for old unselected skills. The receipt's
`seen_skill_ids` records that the current upstream inventory was reviewed.

## Refresh

After approval, replace the provider ref with the reviewed commit:

```bash
bun run skills/skills-sync/src/third-party-skills-cli.ts lock --json
bun run skills/skills-sync/src/third-party-skills-cli.ts lock --execute --json
bun run skills/skills-sync/src/third-party-skills-cli.ts restore --json
bun run skills/skills-sync/src/third-party-skills-cli.ts restore --execute --json
./setup sync --check --json
```
