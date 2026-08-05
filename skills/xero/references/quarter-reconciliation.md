# Quarter Reconciliation And BAS Handoff

## Owners

- Reconciliation contract and private Xero state: `xero-cli commands --json`.
- Live browser connection and action: `skills/browser-use/SKILL.md`.
- Gmail reads and drafts: the `gog gmail` command contract.
- Quarter handoff evidence: `skills/xero/scripts/quarter-ledger.ts`.

The ledger helper is a bundled Bun runtime. Missing Bun is blocked. `xero-cli`
is a local-development dependency; missing command or blocked workspace state
halts reconciliation but does not block read-only ledger status.

## Start One Quarter

1. Read the ledger command catalog and redacted status.
2. Resolve one exact fiscal quarter and inclusive period boundaries.
3. Run `xero-cli commands --json` and `xero-cli workspace status --json`.
4. Follow only the returned `nextSafeAction`. Never inspect XDG state directly.
5. If the Xero workspace, linked command, browser identity, or quarter scope is
   blocked, report the cause and stop before writes.

## Reconcile

1. Ask `xero-cli` to prepare the named quarter.
2. For each browser observation request, attach through
   `browser-connect connect --json` and return only typed observations.
3. Show the bound preview: trusted and exception counts, totals by account,
   compact exceptions, and the preview and intent-set digests.
4. Obtain explicit approval for that exact trusted pass.
5. Ask `xero-cli` for at most one intent. Validate its one-use permit immediately
   before submit, perform that one browser action, and checkpoint the receipt.
6. Repeat from CLI status until the quarter is complete or blocked.
7. Record `reconciled` only from a Xero receipt or explicit manual confirmation.

Never choose or change a ledger account, widen quarter authority, approve an
exception, retry an unknown click, or research a vendor without the matching
typed route and current approval.

## Handoff Ledger

Run the helper with `--json`; read its runtime help rather than copying its
input schema here.

Record evidence only after verification:

| State | Required evidence |
| --- | --- |
| `reconciled` | Xero receipt or explicit manual confirmation |
| `workpaper_exported` | Verified local workbook for the exact quarter |
| `draft_created` | Read-back Gmail draft with expected recipient and attachment |
| `sent_to_accountant` | Gmail sent message, not a draft |
| `lodged` | Accountant statement of lodgment or ATO receipt |
| `payment_due` | ATO notice or accountant advice |
| `paid` | Bank receipt or current ATO account evidence |

Keep evidence references private. Show only the helper's redacted digest in
chat. A ledger entry records what evidence exists; it does not make the event
true by itself.

## Accountant Trail Audit

1. Use `gog` read-only with the exact Google account.
2. Read full message bodies and attachment names, not subjects or snippets only.
3. Separate company BAS, personal PAYG instalments, income-tax returns, debt,
   penalties, and payment notices.
4. Record `sent_to_accountant` only from a sent message containing the expected
   quarter workbook.
5. Record `lodged` only from explicit accountant or ATO evidence.
6. Present a quarter table with period, reconciliation, workpaper, sent,
   lodged, payment, evidence date, and next action.

## Completion

A quarter is operationally complete only when the ledger shows reconciliation,
workpaper export, accountant send, and lodgment evidence. Payment remains a
separate status. If a current quarter is absent, register it with verified
period dates before making claims about completeness.
