---
status: accepted
date: 2026-06-02
---

# Skill Examples Teach Judgment, Not Contracts

ADR 0004 says deterministic workflow contracts live in code, generated docs, or
CLI diagnostics. Skills still need examples: models learn better from concrete
shape than abstract rules, especially when the skill asks for judgment rather
than mechanical field completion.

The risk is drift. A helpful example can become an unofficial schema, field map,
or allowed-values list. Once that happens, prose competes with the contract
runtime and agents must guess which source wins.

## Decision

Skills may include short illustrative examples when examples teach judgment.

Examples must not own deterministic contracts.

Use examples for:

- Good vs bad judgment.
- Common decision shapes.
- Recovery affordance ideas.
- Output tone and granularity.
- Edge cases where the right choice depends on context.

Do not use examples for:

- Required field lists.
- Allowed values.
- Full schemas.
- Routing tables.
- Validation rules.
- Recovery state machines.
- Runtime-owned error or result envelopes.

When exactness matters, prose must point to the contract runtime, generated doc,
or emitting command. It may show a tiny illustrative sketch only when labelled
as illustrative.

Token-heavy examples belong behind a progressive disclosure index only after the
main skill reference becomes noisy. Start with the smallest useful inline
example; split later.

## Consequences

- Skill references can stay teachable without becoming schema owners.
- Contract runtimes keep authority for required shape, drift detection, and
  machine-readable diagnostics.
- Example-heavy skill docs need an explicit entry reference if split across
  files.
- Reviewers should treat long field maps, full payload examples, and repeated
  allowed-value lists in skill prose as drift risks.

## Alternatives considered

- **Ban examples from skills.** Rejected: too abstract for model-read docs.
- **Allow full examples freely.** Rejected: creates parallel policy beside
  runtime contracts.
- **Generate all examples from runtime contracts.** Rejected as default:
  useful when exact examples matter, but too much machinery for judgment
  examples.
