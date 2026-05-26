---
status: accepted
date: 2026-05-26
---

# Template Scaffold Contracts Are Runtime-Owned

ADR 0002 says templates own repeated handoffs. ADR 0004 says deterministic
workflow contracts live in code. Issue-to-PR v2 exposed the missing boundary:
hand-authored YAML scaffolds inside templates can become deterministic packet
and ledger contracts in disguise.

Decision:

```text
Templates may frame handoffs.
Runtime owns scaffold contracts.
Generated or emitted views show scaffold shape.
Hand prose must not maintain scaffold member lists.
```

This applies to packet templates, ledger templates, evidence-row examples,
return envelopes, patch proposals, ce-plan batch blocks, and any other repeated
machine-readable scaffold an agent is expected to fill.

## Placement Rule

- Keep role, authority, read triggers, stop conditions, and judgment in
  hand-authored templates.
- Put repeatable YAML, JSON, packet, ledger, evidence, and finding shapes in
  TypeScript runtime contracts or renderers.
- Emit agent-facing scaffold views from the runtime source through CLI output,
  generated markdown, or generated template blocks.
- Mark generated scaffold blocks with their source command or renderer.
- Treat manual edits to generated scaffold blocks as bugs.

## Rejected Alternatives

- External YAML fragments: tidier files, same second source of truth unless
  generated from TypeScript.
- Inline hand-authored YAML examples: useful at first, but they drift into
  undocumented runtime contracts.
- Prose-only pointers: too weak when agents need a concrete scaffold to fill.

## Consequences

- Template reviews focus on handoff quality, role boundaries, and judgment.
- Contract reviews focus on runtime code, renderer tests, CLI output, and
  generated-view drift checks.
- New workflow scaffolds must start runtime-owned when their shape can be
  parsed, validated, rendered, or reused.
- Existing hand-authored scaffold YAML may migrate incrementally, but new
  duplicated scaffold member lists are not allowed.
