# Xero BAS Workpaper Recording Notes

Source: Chrome Recorder JSON captured 5 August 2026. The recording contains 21
steps and finalises and exports two activity statements.

Status: sanitized source material for a future Xero BAS workpaper runtime. Not
an executable runbook and not authority to finalise, email, or lodge a BAS.

## Purpose And Boundary

Use Xero to prepare and export BAS workpapers for accountant review and filing.

**Finalise & create draft bill** changes the Xero ledger. Exporting the Excel
workbook creates the accountant workpaper. Neither action proves that the BAS
was lodged with the ATO.

## Observed Flow

1. Open Xero.
2. Open **Reporting**.
3. Select **Activity Statement**.
4. Find the exact reporting period and select **Prepare** when required.
5. Review the activity statement and its totals.
6. Select **Finalise & create draft bill**.
7. Confirm **Finalise & create draft bill** in the dialog once.
8. Verify the period is finalised and the draft bill exists.
9. Select **Export**.
10. Select **Excel**.
11. Confirm the export and verify the workbook downloaded.
12. Return to **Reporting** > **Activity Statement**.
13. Repeat for the next required period.

The recording performs this workflow twice. It captures `Jan-Mar 2026` for the
second statement. It does not preserve the first period label, so read and
confirm that period from the live page.

## Pre-Finalise Review Gate

Before **Finalise & create draft bill**, verify the live page shows the intended:

- Xero organisation
- BAS reporting period
- GST accounting basis, when shown
- sales and purchases
- GST collected and GST paid
- PAYG withholding or instalment amounts, when applicable
- total payable to or refundable by the ATO
- adjustments, anomalies, and unreconciled items
- bank reconciliation completed through the period end date

Show these details and obtain fresh, exact human confirmation for the named
period. Preparing or viewing a statement does not authorize finalising it.

## Accountant Handoff

For each period, prepare a package containing:

- exported Excel workbook
- Xero organisation and BAS period
- bank reconciled-through date
- total payable or refundable
- unresolved exceptions and supporting notes

Review the workbook before sending it. Obtain consent before emailing it. Ask
the accountant to confirm receipt, review, and successful lodgment separately.

## Outcome Gate

- Treat **Finalise & create draft bill** as the financial mutation.
- Confirm and submit once for the exact period.
- If the outcome is unknown, never retry immediately.
- Reopen the exact activity statement and inspect its status and draft bill.
- Verify the downloaded workbook belongs to the correct organisation and period.
- Record the period, totals, finalised status, draft-bill reference, exported
  filename, and accountant handoff status.
- Treat only an accountant or ATO receipt as evidence of lodgment.

## Recorder Data Not To Reuse

The raw recording contains an organisation short code, organisation name,
generated element IDs, brittle XPath/CSS selectors, and an authentication
redirect URL. None are copied here.

For future browser automation:

- attach through `skills/browser-use/SKILL.md`
- resolve the live Xero target and organisation every run
- use accessible names such as **Reporting**, **Activity Statement**,
  **Prepare**, **Finalise & create draft bill**, **Export**, and **Excel**
- avoid recorded coordinates, generated IDs, positional selectors, and stale
  authentication URLs

## Missing Evidence

The recording does not preserve:

- the first activity-statement period label
- workbook filenames or download locations
- statement totals or workbook contents
- the created draft-bill references
- accountant recipient or proof of email delivery
- accountant review or ATO lodgment receipt

Do not infer those outcomes from a successful finalise or export action.
