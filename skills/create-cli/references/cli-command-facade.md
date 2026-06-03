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
  `side-quest-engineering:packages/cli-command-facade/AGENTS.md`
- Package vocabulary:
  `side-quest-engineering:packages/cli-command-facade/CONTEXT.md`
- Public production interface:
  `side-quest-engineering:packages/cli-command-facade/src/index.ts`
- Contract grammar, drift checks, usage helpers, discovery projection, and JSON
  writer mechanics:
  `side-quest-engineering:packages/cli-command-facade/src/command-facade.ts`
- Diagnostics mechanics:
  `side-quest-engineering:packages/cli-command-facade/src/cli-diagnostics.ts`
- Test-support subpath:
  `side-quest-engineering:packages/cli-command-facade/src/testing.ts`
- Package tests and fixtures:
  `side-quest-engineering:packages/cli-command-facade/tests/command-facade.test.ts`

## Workflow

- Capture the Minimum CLI design brief from `../SKILL.md`.
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

## Local Link

- This skill's `scripts/` folder may npm-link the private package for local
  validation.
- Treat the link as machine-local.
- Portable consumers need their own link or a published package.

## Review

- Was Facade-backed explicitly requested, or is the surface already
  facade-owned?
- Did Agent-native design happen before facade implementation?
- Are exact contract details read from owner paths?
- Are package-owned literals kept near the package command contract?
- Does validation run against the runtime rather than prose?
- Does the Command Surface Alignment Proof cover the four drift surfaces?
