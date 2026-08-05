# Xero Pay Run Recording Notes

Source: Chrome Recorder JSON captured 5 August 2026. The recording contains 70
steps and posts seven consecutive pay runs.

Status: sanitized source material for a future Xero pay-run runtime. Not an
executable runbook and not authority to create or post a pay run.

## Observed Flow

1. Open Xero.
2. Open **Payroll**.
3. Select **Pay employees**.
4. Dismiss the introductory tour when it blocks the payroll page.
5. Select **New pay run**.
6. Select **Regular pay run** or **Run your next**.
7. Open **Select a pay period**.
8. Choose the required pay calendar and period. The recording shows a calendar
   labelled `Monthly - Amended - ...`, but does not preserve the complete period
   label.
9. Select **Create**.
10. Review the created pay run.
11. Select **Post Pay Run**.
12. Confirm the post in the confirmation dialog.
13. Observe the posted outcome, then select **Close**.
14. Repeat from **New pay run** for the next missing period.

The recording repeats the create, post, confirm, and close loop seven times.
Each pay run is posted separately before the next run is created.

## Pre-Post Review Gate

Before **Post Pay Run**, verify the live page shows the intended:

- Xero organisation
- pay calendar
- pay period start and end dates
- payment date
- included employees
- ordinary earnings and adjustments
- deductions, reimbursements, leave, tax, and superannuation
- gross pay, net pay, tax, superannuation, and total payroll amounts

Require a fresh, exact human confirmation for the named pay run after showing
this review. Creating a draft pay run does not authorize posting it.

## Outcome Gate

- Treat **Post Pay Run** as the financial mutation.
- Submit once after confirmation.
- If the outcome is unknown, never retry the post.
- Inspect the pay-run list or detail page for the exact period and posted status.
- Close only after the posted outcome is visible.
- Record the period, totals, status, and stable receipt or pay-run reference.

## Recorder Data Not To Reuse

The raw recording contains tenant identifiers, pay-run identifiers, generated
element IDs, brittle XPath/CSS selectors, and an authentication redirect URL.
None are copied here.

For future browser automation:

- attach through `skills/browser-use/SKILL.md`
- resolve the live Xero target and organisation every run
- use accessible names such as **Payroll**, **Pay employees**, **New pay run**,
  **Create**, and **Post Pay Run**
- avoid recorded coordinates, generated IDs, positional selectors, and stale
  authentication URLs

## Missing Evidence

The recording does not preserve:

- complete pay-period labels
- employee names or per-employee calculations
- pay-run totals
- the confirmation-dialog wording
- proof of Single Touch Payroll filing
- proof of employee payment or bank-file handling
- durable receipts beyond transient pay-run URLs

Do not infer those outcomes from a successful **Post Pay Run** navigation.
