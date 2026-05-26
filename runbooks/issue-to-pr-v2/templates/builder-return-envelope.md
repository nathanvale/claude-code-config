# Builder return envelope template

**Role:** Builder (writes). Return-envelope shape only — this template
documents the single structured envelope a Builder sub-agent emits at the
end of each attempt.

**Read trigger:** the Builder sub-agent renders this envelope at attempt
exit. The Orchestrator validates it against the schema before recording
the row in `## Batches[].builder_attempts`. See also:
[builder-work-packet.md](builder-work-packet.md),
[`references/builder-dispatch.md`](../references/builder-dispatch.md),
[`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md).

This file is a sibling of `builder-work-packet.md`. Runtime scaffold output
owns concrete field lists; Builder dispatch prose owns role and transition
rules.

## Authoritative source

Concrete envelope shape:
`cli.ts scaffold builder-return-envelope --json`.

Status transitions and the rule that `suggested_validator_focus` is required
live in
[`references/builder-dispatch.md`](../references/builder-dispatch.md#return-envelope).
This envelope is Builder-only. It does not carry Orchestrator-inline attempt
fields; inline evidence is recorded through the separate ledger lane owned by
the Stage 4 batch-loop contract.

## Envelope shape

Resolve the runtime-owned shape through
`cli.ts scaffold builder-return-envelope --json` before returning the envelope.

## What the Orchestrator records

Compact persisted row: `cli.ts scaffold builder-attempt-compact --json`.

Validator Builder-evidence input:
`cli.ts scaffold validator-builder-evidence --json`.

Rich evidence flows into the next Validator packet through
[validator-envelope.md](validator-envelope.md) `builder_evidence`. It does
**not** flow back into a subsequent Builder packet. Orchestrator-inline rows
are not Builder prior attempts and must not be copied into this envelope or
the next Builder packet.

## See also

- [`references/builder-dispatch.md`](../references/builder-dispatch.md) —
  authoritative schema and `suggested_validator_focus` requirement.
- [builder-work-packet.md](builder-work-packet.md) — dispatch packet this
  envelope returns into.
- [validator-envelope.md](validator-envelope.md) — Validator packet that
  carries the seven evidence arrays into the review pass.
