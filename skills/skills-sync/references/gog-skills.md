# Official gog Skills

Use when installing or refreshing the official skills from
`https://github.com/openclaw/gogcli`.

## Ownership

- Selection policy: repository-root `skills-sources.yml`.
- Generated hash evidence: repository-root `skills-lock.json`.
- Acquisition and verification:
  `skills/skills-sync/src/third-party-skills-cli.ts`.
- First-party projection and collision health: repository-root `./setup`.
- Command truth: the installed `gog schema --json`, not copied skill examples.
- Declarative binary install:
  `$HOME/code/dotfiles/config/brew/Brewfile`.
- Monthly freshness receipt:
  `~/.local/state/skills-sync/gog-version-check.json`.

## Install

Keep an exact reviewed allowlist under `openclaw/gogcli` in
`skills-sources.yml`. Never use a wildcard or remove exceptions afterward.
Preflight collisions with `./setup catalog --json`, then:

```bash
bun run skills/skills-sync/src/third-party-skills-cli.ts lock --json
bun run skills/skills-sync/src/third-party-skills-cli.ts lock --execute --json
bun run skills/skills-sync/src/third-party-skills-cli.ts restore --json
bun run skills/skills-sync/src/third-party-skills-cli.ts restore --execute --json
./setup sync --check --json
```

Unlisted upstream skills, including `crabbox`, never enter the install plan.

## Refresh

Review one candidate gogcli commit. After approval, replace only the
`openclaw/gogcli` ref in `skills-sources.yml`, then run the Install commands.

## Monthly CLI Gate

Run during skills-sync when the receipt is absent, invalid, or at least 30 days
old. A skill run is the scheduler; do not claim a background check.

1. Read installed version with `gog --version`.
2. Read the latest stable GitHub release and its release notes:

   ```bash
   gh api repos/openclaw/gogcli/releases/latest
   ```

3. Inspect the installed package channel and available version:

   ```bash
   brew bundle check --file="$HOME/code/dotfiles/config/brew/Brewfile"
   brew info --json=v2 openclaw/tap/gogcli
   ```

4. If current: tell the user gog is current; write the successful check time,
   installed version, latest version, and channel version to the receipt.
5. If outdated: read release notes and `CHANGELOG.md` from the installed version
   through latest; summarize user-visible features and safety changes.
6. Tell the user the installed, latest, and channel-available versions. Ask
   whether to upgrade. Do not mutate the binary or auth state before approval.
7. Write the receipt only after the remote checks and changelog lookup succeed.

After approval:

1. Upgrade through the detected install channel. For Homebrew:

   ```bash
   brew upgrade openclaw/tap/gogcli
   ```

2. If the channel lags the latest GitHub release, report that gap and ask before
   replacing the binary from a release archive.
3. Verify the installed channel and runtime:

   ```bash
   brew test openclaw/tap/gogcli
   gog --version
   gog auth keyring
   gog auth doctor --check --json --no-input
   gog schema --json
   ```

   Homebrew and release-archive installs preserve normal OAuth clients and
   tokens across point releases. Do not migrate auth state unless the doctor
   reports a concrete fault.
4. Pin `openclaw/gogcli` in `skills-sources.yml` to the reviewed commit and run
   the Install commands.
5. Run `./setup sync --check --json`.

## Compatibility

Upstream service skills are generated from the current gog schema. Before using
an unfamiliar or mutating command:

```bash
gog --version
gog schema --json
```

If installed skill examples disagree with the live schema, follow the schema
and update the gog binary before relying on newer flags.

## Runtime Boundaries

- Homebrew owns the gog binary.
- The dotfiles Brewfile owns installation and machine bootstrap intent.
- gog config, data, state, keyring, accounts, and named clients remain outside
  this repository.
- `skills-sources.yml` and the Bun runtime own agent-skill selection only.
- Local desktop agents use the OS keyring. Headless services need the same
  `GOG_HOME` and file-keyring environment on the actual service process.
- CLI-backed reads use `--readonly --no-input --wrap-untrusted --json`.
- The stock binary remains available for confirmed writes. A baked
  `agent-safe` or `readonly` binary is the stronger boundary for unattended
  agents.

`gog mcp` is an optional typed, read-only-by-default adapter. Do not build a
custom gog MCP bridge. Keep skills plus CLI as the default route; consider the
official server only when a client benefits from typed discovery and a narrow
tool allowlist.
