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

This file is a sibling of `builder-work-packet.md` per the U2 plan's
tree sketch (U4-deferred, U5-landed). The **canonical schema** is owned
by
[`references/builder-dispatch.md`](../references/builder-dispatch.md#return-envelope-v1-l184-213);
this template cross-references that schema rather than re-declaring it,
so a single source of truth for status enums and required fields lives
in one place.

## Authoritative source

The schema, the `status` enum (`committed`, `fail-stop-preflight`,
`fail-stop-out-of-scope`, `fail-stop-execution-mode-mismatch`,
`fail-stop-read-failed`, `fail-stop-other`), and the rule that
`suggested_validator_focus` is required live in
[`references/builder-dispatch.md`](../references/builder-dispatch.md#return-envelope-v1-l184-213).

## Envelope shape (mirror of the canonical schema)

```yaml
attempt_type: <implementation | repair>
target_finding_signature: <signature | null>
status: <committed | fail-stop-*>
commit_sha: <sha | null>
files_touched: []
route_hint: <string | null>
blockers: []
probe_results: []
suggested_scope_changes: []
implementation_steps: []
existing_seams_used: []
tests_run: []
assumptions: []
risks: []
deferred: []
suggested_validator_focus: []
notes: ""
```

## What the Orchestrator records

Only the eight compact fields persist into `## Batches[].builder_attempts`
(`attempt_type`, `status`, `commit_sha`, `files_touched`, `route_hint`,
`blockers`, `probe_results`, `notes`). The remaining seven evidence arrays
(`implementation_steps`, `existing_seams_used`, `tests_run`,
`assumptions`, `risks`, `deferred`, `suggested_validator_focus`) flow
into the next Validator packet via the
[validator-envelope.md](validator-envelope.md) `builder_evidence` slot.
They do **not** flow back into a subsequent Builder packet (the U5
Builder packet's `prior_builder_attempts` only carries the compact
ledger-persisted shape).

## See also

- [`references/builder-dispatch.md`](../references/builder-dispatch.md) —
  authoritative schema and `suggested_validator_focus` requirement.
- [builder-work-packet.md](builder-work-packet.md) — dispatch packet this
  envelope returns into.
- [validator-envelope.md](validator-envelope.md) — Validator packet that
  carries the seven evidence arrays into the review pass.
