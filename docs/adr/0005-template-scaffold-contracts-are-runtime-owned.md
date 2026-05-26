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

This applies to packet templates, initial ledger rendering, evidence-row
examples, return envelopes, patch proposals, ce-plan batch blocks, and any
other repeated machine-readable scaffold an agent is expected to fill.

## Placement Rule

- Keep role, authority, read triggers, stop conditions, and judgment in
  hand-authored templates.
- Put repeatable YAML, JSON, packet, ledger, evidence, and finding shapes in
  TypeScript runtime contracts or renderers.
- Source templates default to visible runtime-command pointers, not committed
  scaffold bodies.
- Treat visible scaffold commands as checked section-coordinate pointers once
  drift coverage owns that contract.
- Keep rendered prose artifacts pointer-only by default, including role
  packets. Agents resolve scaffold commands through the CLI at use time.
- Emit concrete YAML only from direct runtime scaffold output or artifacts
  whose output is the generated document itself, such as initial ledger render.
- Treat hidden `scaffold-pointer` comments and committed generated blocks as
  migration mechanisms, not desired source-authoring style.
- Keep initial ledger creation on `ledger-init`; no compatibility ledger
  template survives.

## Rejected Alternatives

- External YAML fragments: tidier files, same second source of truth unless
  generated from TypeScript.
- Inline hand-authored YAML examples: useful at first, but they drift into
  undocumented runtime contracts.
- Prose-only pointers: too weak when agents need a concrete scaffold to fill.
- Embedded packet YAML: convenient for dispatch, but creates another rendered
  prose surface that can drift from runtime scaffold lookup.
- Pointer-only source and packets: chosen boundary. Runtime stays the only
  place that emits scaffold bodies.

## Consequences

- Template reviews focus on handoff quality, role boundaries, and judgment.
- Contract reviews focus on runtime code, renderer tests, CLI output, and
  generated-view drift checks.
- New workflow scaffolds must start runtime-owned when their shape can be
  parsed, validated, rendered, or reused.
- Existing hand-authored scaffold YAML may migrate incrementally, but new
  duplicated scaffold member lists are not allowed.
- Initial ledger reviews target `ledger-init` renderer tests and output, not a
  compatibility template.
- Packet reviews check scaffold command pointers and role discipline, not
  embedded YAML bodies.
