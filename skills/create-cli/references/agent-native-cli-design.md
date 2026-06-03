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
  `../../../CONTEXT.md`.
- Private implementation detail stays out of create-cli prose.

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
- Vocabulary: `../../../CONTEXT.md`.
- Extension decision: `../../../docs/adr/0009-create-cli-uses-bounded-local-extension.md`.
