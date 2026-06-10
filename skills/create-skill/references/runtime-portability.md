# Runtime Portability

Use when a portable skill includes scripts, package managers, runtime helpers,
CLI adapters, generated locks, or local development dependencies.

## Preview Index

- Read `Goal` before choosing runtime shape.
- Read `Runtime Choice` before adding a helper.
- Read `Portable Runtime Surface` for export criteria.
- Read `Bun-Backed Skills` or `Non-Bun Skills` for runtime-specific rules.
- Read `Standalone Bun Helper Scripts` for small Bun scripts without package metadata.
- Read `Multi-Command Bun Packages` when one skill owns multiple commands.
- Read `Local Development Portability` when dependencies point outside the skill.
- Read `Facade Migration Tracking` before adding local facade exceptions.
- Read `Bun Workspace Migration` when moving shared packages into skills.
- Read `Test Layout` when adding runtime package tests.
- Read `Toolchain And Distribution Owners` when repo-wide checks or publishing policy appears.
- Read `Export Rule` before publishing or handing off.

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

## Runtime Choice

- Prefer Bun for helper logic.
- Use Bun for parsing, validation, JSON, file scans, audits, state machines, and reusable decisions.
- Use Bun when focused tests would make the helper safer.
- Use shell only for tiny command wrappers, environment setup, path setup, or pipelines where shell is the domain.
- Promote shell to Bun when branching, parsing, JSON, error handling, or tests matter.
- Name the runtime and missing-runtime state either way.

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
- Treat existing script-local package manifests as migration exceptions only when a tracker names the package and target shape.
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

## Standalone Bun Helper Scripts

Use when the skill has no `package.json` and the helper is small, skill-local, repeated, and deterministic.

- Name Bun as the runtime in the owning skill or reference.
- Keep the script under `scripts/`.
- Use `#!/usr/bin/env bun` when the script is executed directly.
- Keep dependencies limited to Bun built-ins, repo-local files, or explicitly named owner paths.
- Name the verification command that runs the script.
- Escalate to a Bun-backed package when the helper needs package metadata, external dependencies, shared contracts, multiple commands, generated output, or published consumption.

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

## Test Layout

- Collocate package tests with the source owner they verify.
- Name focused tests `<owner>.test.ts`.
- Name live environment tests `<owner>.live.test.ts`.
- Name benchmarks `<owner>.benchmark.ts`; keep them out of the default test script unless the package budget names them.
- Keep fixture code under `fixtures/` when tests need intentionally broken, sample, or generated inputs.
- Keep generated evidence under ignored `var/`, `.runner-output/`, or another declared output path.
- Do not put generated evidence under `src/` unless the package intentionally treats it as source.

## Toolchain And Distribution Owners

- Root workspace metadata owner: `package.json`.
- Runtime package metadata owner: nearest runtime `package.json`.
- TypeScript config owner: nearest runtime `tsconfig.json`.
- Lint config owner: `biome.jsonc`.
- Workspace invariant owner: `scripts/check-workspace-facade-invariants.ts`.
- Workspace portability proof owner: `scripts/prove-workspace-portability.ts`.
- Runtime package context owner: `runtime/cli-command-facade/CONTEXT.md`.
- CLI surface owner: `skills/create-cli/SKILL.md`.
- Use this file only to classify portability, export shape, bundled owners, and missing-runtime state.
- Do not copy repo-wide TypeScript, Biome, workspace, or npm publish policy into this file.

## Export Rule

- Workspace portable bundle: every required runtime owner travels with the export payload and root workspace lockfile.
- Standalone skill zip: every required runtime dependency is public/installable or bundled inside that skill zip.
- Universal portable skill: works as either a workspace portable bundle or standalone skill zip without hidden local state.
- Local development portable skill: works in this repo because a named local owner exists.
- Non-portable skill: needs hidden local state, unlisted tools, missing credentials, or unnamed private dependencies.
