# Agent-Native CLI Design

A CLI is agent-native when a skill driver can discover it, run it, parse
results, recover from failures, and explain what happened without hidden
context.

Read after `cli-guidelines.md`. Use before `cli-command-facade.md`.

## Boundary

- Teach design judgment.
- Keep exact contract shape in the contract runtime.
- Keep examples illustrative, not schema.
- Keep one workflow for humans, plans, scripts, and agents.
- Do not create a parallel agent-only skill.
- Do not require the facade path unless the user asks for it.

## Facade Relationship

- Agent-native is the design goal: discovery, parseable output, recovery, run
  correlation, and side-effect clarity.
- Facade-backed is one enforcement path for that goal, not a competing design
  lane.
- Use `cli-command-facade.md` when the user asks for facade-backed work, a
  package already depends on `@side-quest/cli-command-facade`, or reusable
  runtime validation is the point.
- Keep this reference language-agnostic for agent-native CLIs in Python, shell,
  Node, Bun, or another runtime.
- The facade can enforce machine-checkable contracts; this reference still owns
  design judgment, user mental model, side-effect posture, and recovery intent.

## Runtime-Contract Minimum

- Provide discoverable command purpose and useful help.
- Provide a non-interactive run path.
- Keep primary data parseable.
- Keep diagnostics on stderr.
- Provide structured failure category and same-input retry safety.
- Include run correlation.
- Declare side-effect stance.
- Redact machine-visible sensitive values.
- Include a smoke command or minimal proof path.

## Recipe Triggers

Add recipes when they change driver behavior or reduce real risk.

- **Command discovery:** Add when agents need to choose commands without prose
  guessing.
- **Result contract discovery:** Add when output shape is stable and
  agent-facing.
- **Agent hints:** Add when failures have known safe next actions.
- **Runtime action guidance:** Add when a successful or failed run should
  expose one current-run continuation.
- **Diagnostic capability:** Add when readiness depends on environment, auth,
  config, service reachability, or local dependencies.
- **Write preview:** Add when commands write, destroy, authenticate, bill, or
  mutate externally visible state.
- **Command Surface Alignment Proof:** Add when discovery metadata, rendered
  help, public argv outcomes, and runtime semantics can drift.
- **Output budget controls:** Add when output can become token-heavy.

## Owners

- Name owners before implementation.
- Contract owns package vocabulary, command metadata, action ids, and
  validation.
- Model owns exported runtime types and shared data shapes.
- Engine owns pure policy, ranking, evaluation, and state transitions.
- Discovery owns runtime lookup, provenance, freshness, and capability reports.
- CLI owns argv parsing, IO, rendering, diagnostics, and test harnesses.
- Package-owned result vocabulary owns stable package-specific literals; see
  `../../CONTEXT.md`.
- Private implementation detail stays out of cli-author prose.

## CLI Front Door Shape

- Keep simple single-CLI packages flat.
- Use `src/front-doors/<cli-name>/` when a package has multiple CLIs with
  distinct domains, or when one CLI needs an owner folder.
- Stay flat when multiple CLIs share vocabulary heavily.
- Keep one package-root `package.json` unless distribution, dependency, or
  runtime ownership needs an independent package.
- Name the entry point `cli.ts` inside front-door folders — the folder carries
  identity, the filename carries role.
- Separate entry-point code from application code — the CLI dispatcher owns
  arg parsing, I/O, and exit codes; core logic lives in domain modules.
- For facade-backed contract discovery, locator behavior, and auditor
  invariants, see `references/cli-front-door-layouts.md`.

### Layouts

Three layouts, from simplest to most separated:

**Single CLI, flat.** Most packages. One CLI, all source at `src/` root.

```text
my-package/
  package.json
  src/
    cli.ts
    model.ts
    engine.ts
  tests/
    cli.test.ts
```

**Multiple CLIs, flat contracts.** Multiple CLIs share vocabulary heavily.
All contracts and entry points at `src/` root.

```text
my-package/
  package.json
  src/
    alpha-cli.ts
    beta-cli.ts
    contracts.ts
    shared-model.ts
  tests/
    alpha.test.ts
    beta.test.ts
```

**Multiple CLIs, front-door folders.** CLIs have distinct domains. Each
front door owns its entry point and domain modules under
`src/front-doors/<cli-name>/`. Tests stay at `tests/` root. Entry point is
`cli.ts` — the folder carries identity, the filename carries role.

```text
my-package/
  package.json
  src/
    front-doors/
      alpha/
        cli.ts
        contracts.ts
        model.ts
        engine.ts
      beta/
        cli.ts
        contracts.ts
        model.ts
        runtime.ts
  tests/
    alpha.test.ts
    beta.test.ts
```

### Choosing a layout

| Signal | Layout |
|--------|--------|
| One CLI | Single flat |
| Multiple CLIs, shared vocabulary (result literals, exit codes, actions) | Multi flat |
| Multiple CLIs, distinct command types and result contracts | Front-door folders |
| Not sure yet | Start flat; move to front-doors when seams are clear |

**Pros of front-door folders:**
- Seams visible in the filesystem — open a folder, see exactly what that CLI
  owns.
- Ownership is unambiguous when files grow past ~10 in `src/`.
- Analogous to Go's `cmd/<app>/main.go` pattern (proven at scale).
- Entry point naming is clean: `cli.ts` in every folder, no stuttering.

**Cons of front-door folders:**
- Deeper import paths.
- Migration churn when splitting an existing flat layout.
- Every file reference (tests, docs, owner paths) must update during migration.
- Overkill for two small CLIs that share most of their code.

### Migrating from single to front-doors

- Move existing `src/*.ts` files into
  `src/front-doors/<existing-cli-name>/`.
- Rename the CLI entry point to `cli.ts` inside the front-door folder.
- Update the package script path.
- Update all import paths in source and test files.
- Verify all existing tests pass with zero behavior change before adding
  the second front door.

For facade-backed implementation details (contract `path` field, Command
Contract Locator, auditor fixture references, branch station catalog
placement), see `references/cli-front-door-layouts.md`.

## Implementation Shape

Use when planning or building an agent-native CLI with multiple commands,
shared validation, or structured envelopes.

- Keep the CLI dispatcher thin.
- Let the dispatcher own help, top-level parse routing, command dispatch,
  unknown-command handling, and unexpected-runtime failure wrapping.
- Put command bodies in named handlers once a command has lookup, validation,
  network, file, or mutation behavior.
- Extract repeated target parsing, owner resolution, validation checks, envelope
  builders, and tool-call error builders before the third copy appears.
- Keep exact handler names, helper signatures, and envelope fields in runtime
  code and tests.
- Test through the public command surface when private handlers are
  implementation detail.
- Add direct helper tests only when a branch cannot be observed through command
  tests without brittle setup.
- Run Fallow after meaningful CLI implementation.
- Treat introduced duplication and oversized dispatchers as refactor work.
- Treat `add-tests` findings on private handlers as coverage prompts, not
  automatic direct-test requirements.

## Safety

- Require human handoff for destructive, auth, billing, externally visible, or
  irreversible actions.
- Treat ambiguous side-effect classification as ask-first.
- Preview writes before execute when possible.
- Require explicit execute mode for high-stakes writes.
- Retry only when same-input retry is safe or protected by package-owned
  idempotency.
- Surface idempotency risk before suggesting repair.
- Keep projected discovery text maintainer-authored and sanitized.
- Do not project user, third-party, scraped, or instruction-shaped text into
  agent catalogs.
- Avoid secrets, account identifiers, local paths, debugger URLs, and shell
  command examples in machine catalog text.

## Recovery

- Answer five questions on failure:
  - What happened?
  - What changed?
  - Can the same input retry?
  - What should the driver try next?
  - Where can diagnostics be found?
- Echo invalid input only when useful and safe.
- Include valid alternatives only when the set is small, stable, and cheap.
- Prefer a diagnostics command when more inspection should precede action.
- Never let confidence override side effects, reversibility, idempotency, auth,
  destructive-action, or operator-confirmation gates.

## Observability

- Use quiet success and rich failure.
- Include run correlation.
- Point failures to diagnostics when more inspection would help.
- Keep success logs out of driver context unless requested.
- Treat persisted diagnostics as a separate product decision.

## Review

- Can a fresh driver discover the command and know when to use it?
- Can a non-interactive driver run it without prompts?
- Can machine output be parsed without scraping human text?
- Can failures drive repair without guessing?
- Can the driver correlate the run with diagnostics?
- Can large output stay under context budget?
- Can side effects be previewed or gated?
- Is projected discovery text maintainer-authored and safe?
- Does every stable result literal have the right owner?
- Does the command meet the runtime-contract minimum before heavier recipes?
- Does exact contract shape live with the runtime owner?

## Owner Paths

- CLI baseline: `references/cli-guidelines.md`.
- Facade-backed path: `references/cli-command-facade.md`.
- Vocabulary: `../../CONTEXT.md`.
- Extension decision: `../../../docs/adr/0009-cli-author-uses-bounded-local-extension.md`.
