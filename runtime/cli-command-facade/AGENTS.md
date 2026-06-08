---
status: graduated
---

# CLI Command Facade Agent Instructions

## Read First

- Read this package's `CONTEXT.md`.
- Read the nearest parent `AGENTS.md` and `CONTEXT.md`.
- Read the consuming package's `AGENTS.md`, `CONTEXT.md`, and command adapter
  before changing shared facade behavior.

## Working Rules

- Keep this package package-agnostic. Do not import from `plugins/**`.
- Add shared helpers only after at least two adapters need the same command
  facade behavior.
- Keep command catalogs, route names, domain-specific mutations, privacy policy,
  and runtime lane behavior in the consuming package.
- Keep command discovery generic: this package may define discovery tree shape,
  projection helpers, and package-agnostic drift checks, but consuming packages
  own which commands are exposed, schema names, owner labels, route policy, and
  domain-specific side-effect meaning.
- Keep Result Contract Discovery generic: this package may define optional
  result contract metadata and action affordance shape, plus shape-level drift
  checks. Consuming packages own result schemas, runtime result shapes, action
  meanings, redaction, privacy policy, and output-safety rules.
- Keep diagnostics generic: this package may parse universal diagnostic flags,
  configure the default LogTape Adapter, and protect stdout/stderr discipline,
  but consuming packages own event names, categories, and domain redaction.
- Keep the package root as the production public Interface. Internal
  Implementation files may separate command grammar/discovery from CLI
  diagnostics. The approved public subpath exception is
  `@side-quest/cli-command-facade/testing` for package-agnostic test fixtures
  and helpers. Do not add other public subpath exports without explicit
  approval.
- Treat diagnostic lifecycle helpers such as `configureCliDiagnostics`,
  `parseCliDiagnosticArgv`, `withCliDiagnosticContext`, `emitCliDiagnostic`,
  and `resetCliDiagnostics` as front-door, Gateway runtime, or test-isolation
  support. Package modules should use LogTape loggers for domain diagnostics.

## Checks

```bash
bun --filter @side-quest/cli-command-facade test
bun --filter @side-quest/cli-command-facade typecheck
```

## Testing

- Keep facade tests package-agnostic. They may scan consumers for public-root
  imports, but consumer-specific Adapter placement belongs in the consuming
  package's tests.
- Keep `@side-quest/cli-command-facade/testing` test-only and package-agnostic.
  Package tests may import it to extend shared fixtures, but production code
  should import from the package root.
- Test each facade Interface slice through small fake command contracts before
  relying on a real plugin package as proof.
- Keep diagnostic tests focused on stdout/stderr discipline, JSON Lines
  formatting, diagnostic levels, context propagation, and generic redaction.

## Operational Checks

- No runtime operational checks are owned by this package. Consumer CLI behavior
  is verified by the consuming package.

## Review Traps

- Do not treat Command Metadata Adapter or Command Discovery Adapter usage as
  proof that a package has adopted CLI Diagnostics Adapter behavior.
- Do not add Browser Automation, Memory OS, or other consumer topology rules to
  this package's tests.
- Do not add facade exports for package-specific command catalogs, route
  selection, diagnostic event names, redaction policy, or runtime lane meaning.
- Do not let Result Contract Discovery become a schema registry, global result
  envelope, command router, or package action-policy owner.
