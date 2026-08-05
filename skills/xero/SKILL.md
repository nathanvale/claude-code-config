---
name: xero
description: "Xero quarter reconciliation and BAS accountant-handoff ledger."
disable-model-invocation: true
---

# Xero

Use only after explicit invocation for one named organisation and quarter.

## Route

- Reconcile a quarter, inspect progress, or audit prepared, sent, lodged, and
  payment state: read `references/quarter-reconciliation.md`.
- Import a bank statement, run payroll, finalise a BAS workpaper, or export
  Excel data: read `references/capability-stubs.md` and stop at its handoff.

## Safety Gate

- Treat `draft_created`, `sent_to_accountant`, `lodged`, and `paid` as separate
  evidence states.
- Never infer accountant lodgment from Xero finalisation, an exported workbook,
  a Gmail draft, or a payment notice.
- Use `xero-cli` for reconciliation intent, `skills/browser-use/SKILL.md` for
  live Xero interaction, and `gog` for Gmail evidence.
- Require current human approval before any financial or externally visible
  write. Ledger recording is local evidence, not write authority.

## Start

Run `bun skills/xero/scripts/quarter-ledger.ts commands --json`, then `status
--json`. Follow the route for the oldest incomplete quarter. If no quarter is
named, show the ledger table and ask for one exact quarter.
