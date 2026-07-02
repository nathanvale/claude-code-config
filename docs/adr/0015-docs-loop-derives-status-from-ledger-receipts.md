---
status: accepted
date: 2026-06-21
---

# docs-loop derives verification status from ledger receipts

The storybook-docs-loop CLI derives each batch item's verification status from its ledger receipt fields rather than letting agents set status directly. Agents write individual field receipts via `mark`; the CLI computes whether the item is verified, degraded, or blocked. `advance` is the agent's explicit commitment boundary — it refuses to move past degraded or blocked items without `--force` and a recorded reason.

## Considered Options

- **Agent-set status (rejected).** Agents call `mark --status verified` directly. Simpler CLI logic, but agents can mark "verified" with empty receipts — exactly the silent drift this CLI exists to prevent. Would still need validation rules, which is just derived status with worse UX.
- **Derived status, no override (rejected).** CLI hard-derives status with no agent input. Breaks on legitimate N/A cases — single-variant components don't need a Matrix, but the CLI would permanently show them as degraded. No escape hatch.
- **Derived status with advance as commitment (accepted).** CLI computes a suggested status from ledger state. `mark --field <field> --status done|na|blocked` writes receipts. `advance` is the agent's "I'm done" signal — free for verified, requires `--force` with reason for degraded/blocked. N/A with reason exempts a field from the required set.

## Consequences

- The `mark` command is simple: field + status (done/na/blocked) + optional reason. No item-level status setting.
- Required vs optional field definitions follow the docs-workflow-checklist — the CLI hard-codes the set, not each agent.
- `advance --force` reasons become an audit trail. Over time, frequent force-advances for the same field suggest it should move from required to optional.
- `single` (read-only scouting) does not participate in the receipt workflow — only `batch` runs have durable ledger state.
