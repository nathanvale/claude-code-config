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
- owner scripts inside the skill bundle
- package metadata when packages are required
- lockfile when reproducible install matters
- focused verification command on the first screen
- fallback or blocked state when the runtime is unavailable
- local dependency status when a package points outside the skill bundle

Generated dependency folders are not owner paths.

## Bun-Backed Skills

For Bun-backed skill scripts:

- Name Bun as the runtime.
- Keep `package.json` inside the script owner folder.
- Include `bun.lock` when script-local install or typecheck reproducibility matters.
- Use portable package dependencies when the skill should travel by itself.
- Label `file:` dependencies that point outside the skill bundle as local development portability only.
- Treat private facade packages as non-universal unless the facade owner travels with the export payload.
- Put exact command behavior, parser rules, flags, and output shapes in code, help, tests, or generated docs.
- Put only verification entry points in `SKILL.md`.

## Non-Bun Skills

For Node, Python, shell, or other runtime-backed skills:

- Name the runtime.
- Bundle the script owner files.
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

## Export Rule

- Workspace portable bundle: every required runtime owner travels with the export payload and root workspace lockfile.
- Standalone skill zip: every required runtime dependency is public/installable or bundled inside that skill zip.
- Universal portable skill: works as either a workspace portable bundle or standalone skill zip without hidden local state.
- Local development portable skill: works in this repo because a named local owner exists.
- Non-portable skill: needs hidden local state, unlisted tools, missing credentials, or unnamed private dependencies.
