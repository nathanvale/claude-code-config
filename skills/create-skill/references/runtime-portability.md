# Runtime Portability

Use when a portable skill includes scripts, package managers, runtime helpers,
CLI adapters, generated locks, or local development dependencies.

## Source Notes

- Treat this file as the portable rule owner for Bun and non-Bun runtime portability.
- Source: Codex session `019ea54d-86fe-7a10-9954-166992a6659d`, found with `ce-sessions` on `2026-06-08`.
- Session topic: script-backed skill verification, Bun bootstrap, local facade dependencies, and portable export shape.
- Supporting decisions: `decisions-skill-109` and `decisions-skill-111` through `decisions-skill-121`.
- Local source evidence is provenance only; missing session logs do not block this reference from operating.

## Goal

- Make runtime-backed skills portable without hiding machine assumptions.
- Keep Bun rules explicit without making Bun the only supported runtime.
- Treat every runtime the same way: name it, bundle owners, expose verification, and label missing dependencies.

## Portable Runtime Surface

Runtime-backed skills are portable when they carry or name:

- runtime: Bun, Node, Python, shell, or another required tool
- owner source or helper files inside the skill bundle
- package metadata when packages are required
- lockfile when reproducible install matters
- focused verification command on the first screen
- fallback or blocked state when the runtime is unavailable
- local dependency status when a package points outside the skill bundle

Generated dependency folders are not owner paths.

## Bun-Backed Skills

For Bun-backed skill packages:

- Name Bun as the runtime.
- Keep `package.json` at the skill root.
- Keep Bun-owned source under `src/`.
- Do not put Bun package source under `scripts/`.
- Collocate focused tests beside the owner file as `*.test.ts`.
- Use `fixtures/` only for test fixture programs, sample inputs, or intentionally failing cases.
- Use a separate test folder only when the suite spans multiple owners and collocation would hide the tested boundary.
- Treat existing `scripts/package.json` packages as migration exceptions only when a tracker names the package and target shape.
- Include `bun.lock` when standalone install or typecheck reproducibility matters.
- Use portable package dependencies when the skill should travel by itself.
- Label `file:` dependencies that point outside the skill bundle as local development portability only.
- Treat private facade packages as non-universal unless the facade owner travels with the export payload.
- Package `bin` targets need an executable bit and a shebang.
- Use `#!/usr/bin/env bun` when a TypeScript file is the direct package `bin` target.
- Use `#!/usr/bin/env bash` for wrapper scripts that use Bash features such as arrays, `BASH_SOURCE`, or `set -euo pipefail`.
- Do not use zsh for portable package bins unless the script needs zsh-only behavior and the missing-runtime state is documented.
- Prefer a direct Bun entrypoint over a shell wrapper when the wrapper only delegates to one TypeScript file and adds no path, environment, or compatibility behavior.
- Put exact command behavior, parser rules, flags, and output shapes in code, help, tests, or generated docs.
- Put only verification entry points in `SKILL.md`.

## Non-Bun Skills

For Node, Python, shell, or other runtime-backed skills:

- Name the runtime.
- Bundle the script owner files.
- Use `scripts/` for non-Bun helper scripts when the skill has no `package.json`.
- Name required system commands or packages.
- Include reproducibility files when the ecosystem has them.
- Keep generated caches and dependency installs out of the portable payload.
- Label local-only paths, host tools, private packages, credentials, and environment-specific config.
- Provide a blocked or degraded state when a dependency is missing.

## Local Development Portability

Use this label when a skill works in this repo but does not travel alone.

Examples:

- `file:` package dependency points outside the skill bundle.
- helper command lives in another local repo.
- private package is available only through a local checkout.
- script requires host config that is not bundled or documented.

Next repair:

- bundle the dependency
- promote the dependency to the export payload
- replace it with a public package
- keep it local-only and label the blocked state

## Facade Migration Tracking

Track each runtime package that depends on a local facade owner.

For each package, record:

- package owner path
- facade owner path
- current portability status
- blocker
- target portability status
- next repair option

Do not mark a facade-backed package universal portable while its facade dependency points outside the portable payload.

For a private pre-1.0 facade used by multiple skills, prefer one shared portable runtime owner before copying the facade into each skill or publishing it externally.

## Bun Workspace Migration

Use Bun workspaces when a shared portable runtime owner is bundled in this repo.

Source:

- Bun workspaces: `https://bun.sh/docs/pm/workspaces`
- Bun filters: `https://bun.sh/docs/pm/filter`
- Bun install and lockfile behavior: `https://bun.sh/docs/pm/cli/install`

Rules:

- Add the shared runtime package to root `package.json` workspaces.
- Give each workspace package its own `package.json` with a stable `name`.
- Use `workspace:*` for local package dependencies inside the workspace.
- Run `bun install` from the workspace root so Bun links local workspace packages and updates the root `bun.lock`.
- Use `bun install --filter <package-or-path>` for focused dependency installs when needed.
- Use `bun run --filter <package-or-path> <script>` for focused package scripts when useful.
- Use `bun ci` or `bun install --frozen-lockfile` for reproducible CI or export verification.
- Keep root `bun.lock` with the portable export payload when workspace dependencies are part of the payload.
- Prove workspace export with `bun run prove:workspace-portability`.

## Test Layout

- Collocate package tests with the source owner they verify.
- Name focused tests `<owner>.test.ts`.
- Name live environment tests `<owner>.live.test.ts`.
- Name benchmarks `<owner>.benchmark.ts`; keep them out of the default test script unless the package budget names them.
- Keep fixture code under `fixtures/` when tests need intentionally broken, sample, or generated inputs.
- Keep generated evidence under ignored `var/`, `.runner-output/`, or another declared output path.
- Do not put generated evidence under `src/` unless the package intentionally treats it as source.

## Distribution Governance

- Keep runtime-backed skill packages `private: true` until a distribution decision names package, version, access, payload, dependency status, and verification command.
- Do not set `private` false while a package still depends on hidden local state, `file:` specs, or unresolved workspace-only dependencies.
- Require a stable package `name` before public distribution.
- Require an explicit semver `version`; do not publish placeholder `0.0.0`.
- Require a short `description` for discovery and package audit readability.
- Require a license stance; do not use `UNLICENSED` with public npm access.
- Require `publishConfig.access` so the first publish cannot default to the wrong visibility.
- Require `publishConfig.tag` so pre-release or private-channel publishes do not land as implicit latest.
- Require a narrow `files` allowlist.
- Do not use `*`, `.`, or `**/*` as the distribution payload.
- Keep generated evidence, test output, dependency folders, local temp state, and hidden machine state out of the packed payload.
- Keep collocated tests, live tests, benchmarks, and fixtures out of public package payloads unless a distribution decision accepts them.
- Do not rely on `.npmignore` or `.gitignore` to prune a broad `files` allowlist.
- Cover every package `bin` target from the `files` allowlist.
- Do not use `bundleDependencies` or `bundledDependencies` until the bundled dependency payload is explicitly accepted.
- Declare `engines.bun` when a distributed package exposes direct TypeScript Bun entrypoints.
- Choose source distribution only when Bun is the named consumer runtime and collocated tests or fixtures are excluded from the payload.
- Choose built distribution when consumers should not receive source tests, fixtures, or TypeScript runtime assumptions.
- Treat built `dist/` folders as generated package payloads; rebuild them from source during proof instead of relying on checked-in output.
- For built distribution, verify the packed payload has no tests, fixtures, workspace-only dependency markers, generated evidence, or local temp state.
- Prove publish readiness with `bun publish --dry-run --frozen-lockfile` before flipping `private` off.
- Use `bun pm pack --dry-run` when validating tarball contents without registry semantics.
- Use `npm pack --dry-run` as a compatibility cross-check when npm install or npm publish behavior is a target.
- Keep standalone skill zip governance separate from npm package distribution governance.

## Export Rule

- Workspace portable bundle: every required runtime owner travels with the export payload and root workspace lockfile.
- Standalone skill zip: every required runtime dependency is public/installable or bundled inside that skill zip.
- Universal portable skill: works as either a workspace portable bundle or standalone skill zip without hidden local state.
- Local development portable skill: works in this repo because a named local owner exists.
- Non-portable skill: needs hidden local state, unlisted tools, missing credentials, or unnamed private dependencies.
