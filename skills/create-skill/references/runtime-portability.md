# Runtime Portability

Use when a portable skill includes scripts, package managers, runtime helpers,
CLI adapters, generated locks, or local development dependencies.

## Preview Index

- Read `Goal` before choosing runtime shape.
- Read `Portable Runtime Surface` for export criteria.
- Read `Bun-Backed Skills` or `Non-Bun Skills` for runtime-specific rules.
- Read `Multi-Command Bun Packages` when one skill owns multiple commands.
- Read `Local Development Portability` when dependencies point outside the skill.
- Read `Facade Migration Tracking` before adding local facade exceptions.
- Read `Bun Workspace Migration` when moving shared packages into skills.
- Read `TypeScript Governance`, `Lint Portability`, and `Test Layout` when changing checks.
- Read `Distribution Governance` and `Export Rule` before publishing or handing off.

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
- Keep `tsconfig.json` at the skill root when the package typechecks TypeScript.
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
- Do not add package `bin` entries only for repo-local commands.
- Published or externally consumed package `bin` targets need an executable bit and a shebang.
- Use `#!/usr/bin/env bun` when a TypeScript or JavaScript file is the direct package `bin` target.
- Use `#!/usr/bin/env bash` for wrapper scripts that use Bash features such as arrays, `BASH_SOURCE`, or `set -euo pipefail`.
- Do not use zsh for portable package bins unless the script needs zsh-only behavior and the missing-runtime state is documented.
- Prefer a direct Bun entrypoint over a shell wrapper when the wrapper only delegates to one TypeScript file and adds no path, environment, or compatibility behavior.
- Put exact command behavior, parser rules, flags, and output shapes in code, help, tests, or generated docs.
- Put only verification entry points in `SKILL.md`.

## Multi-Command Bun Packages

Use when one skill owns more than one CLI tool or runtime helper.

- Keep one package per skill when the commands serve one workflow, share contracts, or share state.
- Split into another package only when commands serve different skills, have different distribution status, or need independent dependency/runtime boundaries.
- Keep all Bun-owned source under `src/`.
- Put public CLI entrypoints at `src/<command-name>.ts`.
- Put shared contracts at `src/command-contract.ts` when commands share discovery, metadata, or result vocabulary.
- Put shared model and policy files at `src/<domain>-model.ts`, `src/<domain>-engine.ts`, `src/<domain>-validation.ts`, or similarly owned names.
- Prefer command-domain prefixes over a generic `src/tools/` bucket.
- Use `src/<command-name>/` only after one command grows enough files that a flat prefix becomes harder to scan.
- In a command folder, keep the executable owner obvious: `src/<command-name>/cli.ts` or `src/<command-name>/index.ts`.
- Collocate tests beside the owner they verify before creating a broad test folder.
- Keep prototypes, fixtures, and generated evidence out of command folders unless the folder explicitly owns them.
- Keep package scripts as the repo-local source-mode entrypoints for every command.
- Reserve package `bin` entries for published or externally consumed command contracts.

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

## TypeScript Governance

Use for active Bun workspace packages that typecheck runtime owners.

Source:

- Bun TypeScript docs: `https://bun.sh/docs/runtime/typescript`
- Bun workspaces catalog docs: `https://bun.sh/docs/pm/workspaces`
- TypeScript TSConfig docs: `https://www.typescriptlang.org/tsconfig`

Rules:

- Let root `package.json` own shared TypeScript tool versions through `workspaces.catalog`.
- Lock `typescript`, `@types/bun`, and `@types/node` together.
- Use `catalog:` in active workspace package `devDependencies`.
- Do not use `*`, `^`, `~`, or package-local exact versions for compiler or ambient runtime type packages in active workspace packages.
- Use `@types/bun` for Bun CLI packages.
- Use `compilerOptions.types: ["bun"]` for Bun CLI packages.
- Do not declare direct `bun-types`; it is an implementation dependency of `@types/bun`.
- Use `@types/node` and `compilerOptions.types: ["node"]` only for Node-library source packages.
- Classify each active workspace package before adding TypeScript rules.
- Keep portable package `tsconfig.json` files self-contained.
- Do not extend repo-root `tsconfig` from a portable package unless the export payload carries that root config.
- Keep shared TypeScript policy in `scripts/check-workspace-facade-invariants.ts`.
- Keep active package facts in package manifests, root workspaces, and conventional owner paths.
- Do not add a separate package registry while the checker can derive the fact from `package.json`, `tsconfig.json`, `bin`, `scripts`, or `src/command-contract.ts`.
- Keep prose short; enforce exact compiler options in checks.
- Treat `noUncheckedIndexedAccess` as an intentional non-enforced hardening pass until source and tests have explicit indexed-access guards.

## Lint Portability

Use for Biome or another lint/format gate over Bun workspace skill packages.

Source:

- Biome config and VCS ignore: `https://biomejs.dev/reference/configuration/`
- Biome monorepo guide (root vs nested, v2): `https://biomejs.dev/guides/big-projects/`

Rules:

- Treat the linter as a repo-wide dev gate, not a per-skill runtime owner.
- Keep one root Biome config; do not add per-skill `biome.json` or per-skill Biome dependencies.
- Install Biome once at the repo root through root `devDependencies`.
- Lint config does not travel inside a standalone skill zip; the importing repo runs its own lint gate.
- Exclude generated payloads path-portably with `!**/dist` and `!**/coverage`, not skill-specific globs.
- Do not rely on `vcs.useIgnoreFile` alone when `files.includes` re-includes everything with `**`; an explicit `**` glob overrides the git-ignore.
- Edit lint findings in `src/`; never edit generated `dist/` output to satisfy the linter.
- Add a nested per-skill `biome.json` only when one skill needs genuinely different rules; mark it `extends: "//"` (v2 microsyntax, implies `root: false`).
- Treat a nested `extends: "//"` config as workspace-local only; the `//` root does not travel in a standalone skill zip, so it is the same hidden-local-state trap as extending repo-root `tsconfig`.

## Test Layout

- Collocate package tests with the source owner they verify.
- Name focused tests `<owner>.test.ts`.
- Name live environment tests `<owner>.live.test.ts`.
- Name benchmarks `<owner>.benchmark.ts`; keep them out of the default test script unless the package budget names them.
- Keep fixture code under `fixtures/` when tests need intentionally broken, sample, or generated inputs.
- Keep generated evidence under ignored `var/`, `.runner-output/`, or another declared output path.
- Do not put generated evidence under `src/` unless the package intentionally treats it as source.

## Distribution Governance

- Treat skills as instruction bundles, not npm package products.
- Publish only runtime tools, libraries, adapters, or shims that a skill consumes outside the skill system.
- Keep `SKILL.md`, references, provenance, tests, fixtures, and workflow docs out of npm payloads unless a distribution decision names the skill bundle itself as the product.
- Use repo-local scripts for source-mode work.
- For Bun-backed skill packages, run repo-local commands with `bun run <script>` from the package root.
- For Bun workspace verification, run package scripts with `bun --filter <package-name> <script>` from the repo root.
- Use installed command names only for published package docs, packed-tarball smoke tests, or installed-tool usage.
- Let CLI contracts name command identity only; do not encode `bun run`, `dist/`, or local paths as the command identity.
- Keep runtime-backed skill packages repo-local and `private: true` by default.
- Start publish governance only when a runtime tool is consumed outside the repo or `private: false` is proposed.
- Keep runtime-backed skill packages `private: true` until a distribution decision names package, consumer, version, access, payload, dependency status, and verification command.
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
- Treat public package `bin` entries as install contracts.
- Do not point public package `bin` entries at `src/`, tests, fixtures, or dev wrappers unless a distribution decision records a source-distribution exception and the checker allowlists it.
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
