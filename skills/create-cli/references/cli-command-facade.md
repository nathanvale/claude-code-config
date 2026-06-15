# Facade-Backed CLI Path

Use this only for explicit facade-backed implementation, reusable facade code,
facade runtime validation, `@side-quest/cli-command-facade`, or an existing
facade-owned surface.

Facade-backed means: apply Agent-native CLI design, then use the facade runtime
as the enforcement backend.

## Boundary

- Keep `create-cli` as the design front door.
- Keep exact contract shape in `@side-quest/cli-command-facade`.
- Keep command catalog meaning, route policy, result vocabulary, redaction, and
  runtime semantics in the consuming package.
- Do not copy facade fields, generated envelopes, parser rules, validator
  categories, or helper signatures into skill prose.
- Prefer owner paths over remembered API details.

## Owner Paths

- Package instructions:
  `runtime/cli-command-facade/AGENTS.md`
- Package vocabulary:
  `runtime/cli-command-facade/CONTEXT.md`
- Public production interface:
  `runtime/cli-command-facade/src/index.ts`
- Contract grammar, drift checks, usage helpers, discovery projection, and JSON
  writer mechanics:
  `runtime/cli-command-facade/src/command-facade.ts`
- Branch Station model and Station Map projection:
  `runtime/cli-command-facade/src/station-map.ts`
- Diagnostics mechanics:
  `runtime/cli-command-facade/src/cli-diagnostics.ts`
- Test-support subpath:
  `runtime/cli-command-facade/src/testing.ts`
- Package tests and fixtures:
  `runtime/cli-command-facade/tests/command-facade.test.ts`
- Cross-package Station Map report:
  `skills/cli-execution-auditor/src/station-map.ts`
  This path appears here because the facade owns the generic Station Map model;
  the auditor owns the cross-package report that applies it to target CLIs.

## Workflow

- Capture the Minimum CLI design brief from `SKILL.md`.
- Apply `agent-native-cli-design.md`.
- Name owners before implementation:
  - Contract owner.
  - Model owner.
  - Engine owner.
  - Discovery owner.
  - CLI owner.
  - Test owner.
- Read the owner paths above for exact runtime shape.
- Emit or update the package-owned command contract in the consuming package.
- For new or expanded facade-backed CLIs, name the initial Branch Station ids
  in the plan before implementation writes code.
- Scaffold a package-owned Branch Station Catalog beside `command-contract.ts`
  before runner behavior or process integration rows.
- Validate at construction with the facade runtime.
- Use the no-throw parse path when an autonomous loop needs repair hints.
- Stop and hand off when validation returns an issue with no known correction.

## Proof Expectations

- Prove discovery metadata, rendered help, public argv outcomes, and runtime
  semantics cannot drift.
- Prefer facade testing-subpath helpers when available.
- Keep proof scenario-based.
- Cover advertised flags in help.
- Cover command-foreign flags excluded from help.
- Cover public argv acceptance and rejection.
- Cover command semantics through runtime probes.
- Assert package-owned result vocabulary from package-owned constants.
- For Branch Station work, prove the Station Map only claims Declared Branch
  Coverage and reports missing, drifted, skipped, or declared-unreachable
  stations mechanically.

## Coach-Filled Gaps

The facade validates machine-checkable runtime shape. The CLI coach still owns
judgment for:

- Naming.
- User mental model.
- Human help quality.
- Examples.
- Config precedence.
- TTY behavior.
- Color and pager behavior.
- Ctrl-C handling.
- Deprecation and migration posture.
- Package-owned safety policy.
- Package-owned recovery meaning.

## Gotchas

### Error hints reject commands and local paths

- The facade scans every agent-facing envelope text and refuses commands
  (`bun`, `npm`, `git`, ...) and local paths (`/Users/...`).
- Rule owner: `runtime/cli-command-facade/src/runtime-text-safety.ts`.
- A hint that inlines a fix command throws at envelope construction, not in a
  test; the command path never runs.
- Repair channel: keep the hint prose-only `summary`, set a structured
  `action`, and point `docs_url` at the doc that owns the real command.
- Commands live in docs; hints reference docs. No command string, no drift.

### `bun --filter` is a display wrapper, not a CLI surface

- `bun --filter <pkg> <script>` (Bun 1.3.14) elides child stdout to ~10 lines
  and does not forward parent stdin to the child.
- Never pipe a stdin receipt through `--filter`; the child sees empty stdin.
- Never assert program help or output through `--filter`; the wrapper truncates
  it and the assertion tests display budget, not the program.
- Invoke the runner directly for stdin-fed commands and for output assertions:
  `bun run <path-to-runner> <command>`.

## Local Link

- This repo wires the facade through Bun workspaces.
- Portable consumers need a published package or export payload that includes
  `runtime/cli-command-facade`.

## Review

- Was Facade-backed explicitly requested, or is the surface already
  facade-owned?
- Did Agent-native design happen before facade implementation?
- Are exact contract details read from owner paths?
- Are package-owned literals kept near the package command contract?
- Does validation run against the runtime rather than prose?
- Does the Command Surface Alignment Proof cover the four drift surfaces?
