# success-verify

## Question

An agent re-drives a saved browser flow (e.g. "submit weekly timesheet"), possibly UNATTENDED every Friday. Clicking "Submit" is NOT proof the submission worked — a silent failure means the user believes their timesheet was filed when it wasn't.

Can a success-verification layer turn the terminal action into a THREE-WAY outcome — `confirmed` / `failed` / `ambiguous` — so an unattended run only records success when it actually SAW a real confirmation signal, and never treats `ambiguous` as success?

## How to run

```bash
bun success-verify.ts
```

Pure TS, zero deps, no network. Post-submit page states are modelled as in-memory fixtures (confirmed, failed, ambiguous).

## Verdict

Three-way verification works. From the actual run:

- Clean confirmation → `confirmed` → recorded **success** (url matched `/timesheet/confirmation`)
- Validation error → `failed` → recorded **failure** (text matched "Could not submit")
- Spinner stuck → `ambiguous` → recorded **needs-human** (no success or failure signal; ALERT before next unattended run)

Result: **1/3 recorded success; 2 would-be false positives caught by the verifier.** The naive "we clicked submit, so it worked" baseline records **all three as success** — it wrongly passes both the validation error and the spinner-stuck page.

Ambiguous is NOT success. It routes to `needs-human`, so an unattended run alerts instead of silently claiming the timesheet was filed. That is the core safety property.

## Findings for browser-domain-memory

- **A terminal step must carry a `successSignal` spec, not just a click target.** The spec declares what observable proves the action went through. Without it, "click resolved" is the only evidence, and it lies.
- **Verification is three-way, and the third state earns its keep.** `confirmed` / `failed` / `ambiguous`. The whole point is the third one: when no signal is present, the correct answer is "I can't tell," not "success." Unattended runs must escalate on `ambiguous`, never record success.
- **Check failure signals before success signals.** An explicit error ("Could not submit", `#form-error-summary`) outranks incidental success-looking text on the same page.
- **Support multiple signal types; no single one is sufficient.** The prototype uses url-pattern, text-match, element-present, and form-cleared. Different domains expose success differently (confirmation URL vs banner vs reference number).
- **Weak signals need mid-flight guards.** `form-cleared` (form went disabled) looks like success — but a form disabled *while a spinner is showing* is mid-flight, not done. A naive form-cleared check turned the spinner-stuck page into a false positive until the verifier learned to suppress it when a `spinner`/`loading` element is present. Lesson: pair fragile signals with negative guards, or prefer a positive confirmation signal (URL / reference number) as the primary check.
- **The run record reflects the VERIFIED outcome, not the action taken.** `recordRun` persists `success` / `failure` / `needs-human` keyed off `verifyOutcome`, so the durable history can't claim a submission that was never confirmed.
