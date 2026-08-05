# Xero Capability Stubs

These routes are discovery stubs. They do not authorize or implement live Xero
actions.

## Bank Statement Import

Status: not implemented.

Future runtime owner: `xero-cli`. It needs account and period binding, file
type detection, duplicate preview, dry-run output, one explicit import approval,
and a post-import receipt before this route can execute.

Current handoff: identify the exact account, period, and QIF, OFX, or CSV file;
report the route as blocked. Never import through improvised browser clicks.

## Payroll Runs

Status: recording-derived source only. Read `pay-run-recording.md`.

Future owner must separate draft creation, totals review, posting, Single Touch
Payroll filing, and employee payment. **Post Pay Run** needs fresh approval for
the exact period and a submit-once outcome check.

Current handoff: show the captured period limitations and stop before creating
or posting a pay run.

## BAS Finalise And Export

Status: recording-derived source only. Read `bas-workpaper-recording.md`.

Future owner must separate statement review, **Finalise & create draft bill**,
Excel export, accountant send, accountant lodgment, and payment. Xero
finalisation is a ledger mutation, not ATO lodgment.

Current handoff: show the exact quarter and review gate; stop before finalising
or exporting.

## Excel Data Export

Status: not implemented as a general Xero export.

Future owner must name the report, organisation, period, format, destination,
and read-back verification. BAS workpaper Excel export belongs to the BAS route;
other reports require their own explicit contract.

Current handoff: identify the requested Xero report and period, then stop as
blocked rather than reusing recorded selectors.
