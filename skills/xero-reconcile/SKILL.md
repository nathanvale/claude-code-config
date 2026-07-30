---
name: xero-reconcile
description: "Reconcile one Xero quarter through the managed xero-cli workflow."
disable-model-invocation: true
---

# Xero Reconcile

Drive one quarter through `xero-cli`. The CLI owns financial intent, private
state, authority records, pacing, receipts, repair, and completion.

## Start

- Require `command -v xero-cli`.
- Read `xero-cli commands --json`; treat its catalog, side-effect stance, and
  contract digest as current truth.
- Read `xero-cli workspace status --json`.
- Follow the returned `nextSafeAction`; never inspect XDG files directly.
- If the linked command or managed catalog is missing, stop as blocked.

## Workflow

1. Resolve one named quarter and run the CLI's preparation action.
2. When the CLI emits a browser observation request, use
   `skills/browser-use/SKILL.md`. Connect only through
   `browser-connect connect --json`; return only the typed observation result
   to the CLI.
3. Show the bound preview: Trusted Match and Exception counts, totals by
   account, compact Exception summary, preview-envelope digest, and
   financial-intent-set digest.
4. Ask the human to approve or decline that named Trusted Pass. Record Quarter
   Authorization only from the current reply.
5. Ask the CLI for at most one next intent. Use the browser workflow for that
   exact row, validate its permit immediately before submit, then checkpoint
   the typed receipt.
6. Repeat from CLI status. Stop at Trusted Pass Complete or Quarter Complete.

## Safety Gate

- Record browser automation authority only after current, exact tenant,
  bank-account, quarter, date-boundary, access-scope, lifecycle, and agreement
  attestation.
- Never choose an account, alter a financial intent, widen authority, approve
  an Exception, research a vendor, authorize rollback, or authorize retirement
  through prose.
- Never use raw browser drivers, direct Xero page scripting, or a loop of
  browser writes. The browser owner handles one CLI intent at a time.
- On an unknown outcome, stale lease, drift, or repair response, stop all
  writes and follow the CLI repair action. Never retry the click.
- Keep transaction data, mappings, identifiers, credentials, and local paths
  out of skill source and chat summaries.

## Next Safe Action

No argument: run `xero-cli workspace status --json`, then follow its one bounded
continuation.
