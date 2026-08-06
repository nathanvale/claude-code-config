# CLI Front Door Layouts (Bun / TypeScript)

Facade-backed implementation details for the layout patterns described in
`agent-native-cli-design.md`. Read after `agent-native-cli-design.md` and
before or alongside `cli-command-facade.md`.

## Single CLI, Flat

Most packages. One `defineCommandFacadeContract` call, one package script.

```text
my-package/
  package.json                          ← "my-cli": "bun run src/cli.ts"
  src/
    command-contract.ts                 ← defineCommandFacadeContract
    cli.ts                              ← CLI entry point
    model.ts
    engine.ts
    branch-station-catalog.ts           ← optional; add per facade testing strategy
  tests/
    cli.test.ts
    cli.integration.test.ts
    branch-station-catalog.test.ts
```

Command Contract Locator discovers `src/command-contract.ts`.

- Reference: `skills/browser-use/src/command-contract.ts` — one
  `browserUseContracts` export (6 commands) behind one `browser-use` bin,
  flat layout (post-migration surface, 2026-07-16).

## Multiple CLIs, Flat Contracts

Multiple `defineCommandFacadeContract` calls in one `src/command-contract.ts`.
Each CLI has its own package script and entry point at `src/` root.

```text
my-package/
  package.json                          ← scripts: alpha, beta
  src/
    command-contract.ts                 ← exports alphaContracts, betaContracts
    alpha-cli.ts
    beta-cli.ts
    shared-model.ts
    branch-station-catalog.ts
  tests/
    alpha.test.ts
    alpha.integration.test.ts
    beta.test.ts
    beta.integration.test.ts
    branch-station-catalog.test.ts
```

- Each contract export has its own command type union.
- Each CLI's `commands --json` projects only its own contract surface.
- Command Contract Locator discovers one `src/command-contract.ts` with
  multiple exports.
- Historical reference: browser-use before the 2026-07 migration — 6 contract
  exports across 5 CLI scripts in one `src/command-contract.ts`. Its surviving
  surface is single-CLI (see "Single CLI, Flat" above); no current in-repo
  exemplar of this layout remains.

**When to use:** CLIs share vocabulary (result literals, exit codes, action
id enums, shared model types). Co-locating contracts makes shared imports
trivial.

## Multiple CLIs, Front-Door Folders

Each CLI owns a folder under `src/front-doors/<cli-name>/` with its own
`command-contract.ts`, `cli.ts`, and domain modules.

```text
my-package/
  package.json                          ← scripts: alpha, beta
  src/
    front-doors/
      alpha/
        command-contract.ts             ← own defineCommandFacadeContract
        cli.ts                          ← CLI entry point
        model.ts
        engine.ts
        branch-station-catalog.ts       ← alpha stations only
      beta/
        command-contract.ts             ← own defineCommandFacadeContract
        cli.ts                          ← CLI entry point
        model.ts
        runtime.ts
        branch-station-catalog.ts       ← beta stations only
  tests/
    alpha.test.ts
    alpha.integration.test.ts
    beta.test.ts
    beta.integration.test.ts
    branch-station-catalog.test.ts      ← validates both catalogs
```

- Each front door's contract `path` field matches its actual file location:
  `path: "src/front-doors/alpha/command-contract.ts"`.
- Each CLI's `commands --json` projects only its own contract surface.
- Command Contract Locator discovers both via the
  `src/front-doors/**/command-contract.ts` glob (depth-N supported).
- Reference fixture:
  `cli-execution-auditor/src/fixtures/good-front-door-local/`.

**When to use:** CLIs own distinct command type unions, result contracts,
and action affordances. Front-door folders make ownership seams visible in
the filesystem.

### Shared root + front-door-local

When CLIs share some vocabulary but own distinct commands, keep a root
`src/command-contract.ts` that exports shared types. Each front-door contract
imports from it.

Command Contract Locator discovers both the root contract and the front-door
contracts. Both can coexist.

## Entry Point Naming

- Inside front-door folders: always `cli.ts`. The folder carries identity
  (`front-doors/storybook-doctor/`), the filename carries role (`cli.ts`).
  Avoids stuttering (`storybook-doctor/storybook-doctor.ts`).
- At `src/` root (flat layouts): use `cli.ts` for single-CLI packages, or
  `<cli-name>-cli.ts` for multi-CLI flat layouts where the filename must
  disambiguate.

## Branch Station Catalog Placement

Branch station catalogs are orthogonal to the front-door layout. Three options:

- **Per front door** (recommended for front-door layout): each front door owns
  its own `branch-station-catalog.ts` with stations for that CLI only.
- **Shared root** (recommended for flat layouts): one
  `branch-station-catalog.ts` at `src/` root covering all CLIs.
- **Mixed**: root catalog for shared stations, front-door-local catalogs for
  CLI-specific stations.

The `branch-station-catalog.test.ts` at `tests/` root validates all catalogs
against their respective command discovery. When multiple catalogs exist,
assert no station ID collision.

## Package Script Shape

Each CLI needs a package script entry pointing to its entry point:

```json
{
  "scripts": {
    "alpha": "bun run src/front-doors/alpha/cli.ts",
    "beta": "bun run src/front-doors/beta/cli.ts"
  }
}
```

The `script` field in each `defineCommandFacadeContract` call must match a
declared script name. The workspace facade invariant gate validates this.

## Auditor Safety Patterns

- **Command name collision:** command names must not collide across front doors
  in the same package. The auditor catches duplicates at contract acquisition
  time. Reference fixture:
  `cli-execution-auditor/src/fixtures/bad-front-door-duplicate-command/`.
- **Uncovered front door:** every front door with a package script must have a
  discoverable `command-contract.ts`. A front door missing its contract goes
  unaudited while the auditor reports clean. Reference fixture:
  `cli-execution-auditor/src/fixtures/bad-front-door-uncovered/`.

## Migrating from Single Flat to Front-Door Folders

1. Create `src/front-doors/<existing-cli-name>/`.
2. Move all existing `src/*.ts` files into the new folder.
3. Rename the CLI entry point to `cli.ts` inside the folder.
4. Update the `package.json` script path:
   `"my-cli": "bun run src/front-doors/my-cli/cli.ts"`.
5. Update the contract's `path` field in `defineCommandFacadeContract`.
6. Update all import paths in source and test files.
7. Verify all existing tests pass with zero behavior change.
8. Add the second front door.

## Owner Paths

- Command Contract Locator:
  `cli-execution-auditor/src/command-contract-discovery.ts`.
- Workspace facade invariant gate:
  `scripts/check-workspace-facade-invariants.ts`.
- Facade testing subpath:
  `runtime/cli-command-facade/src/testing.ts`.
- Test fixture package:
  `runtime/cli-test-fixtures/`.
- Front-door fixtures (canonical):
  `cli-execution-auditor/src/fixtures/good-front-door-local/`.
- Depth-N front-door fixture:
  `cli-execution-auditor/src/fixtures/good-front-door-nested/`.
