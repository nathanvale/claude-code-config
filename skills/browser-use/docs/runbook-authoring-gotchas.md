# Runbook + reviewed-action authoring gotchas

Read this before authoring or debugging ANY Browser Use runbook or reviewed action,
for ANY portal. These are general authoring hazards; each is stated as a portable
principle first. Where a concrete illustration helps, the example is drawn from the
FastTrack timesheet build (2026-08-03/04) — chosen because FastTrack is an Angular
single-page app, which is the trickiest common case (client-side routing, dynamic
DOM, server-control ids). Portal-specific DOM facts are quarantined in the
"Worked example: FastTrack (Angular SPA)" section at the end — treat those as one
portal's evidence, not universal rules.

How to read a gotcha: the **principle** is portable; any FastTrack detail is just
the case that taught it. When you author for a new portal, apply the principle and
DISCOVER that portal's own specifics via CDP (G7) — do not copy FastTrack's
selectors/routes.

The single most important lesson: **almost every failure surfaces as the generic
`task_run_effect_unknown` at the action step, with the real reason SWALLOWED.**
The lane maps any failed mutation-action evaluation to `unknown` and discards the
action's thrown message. To see the real reason, instrument the swallow point
(`browser-use-agent-browser.ts`, the `if (!commandSucceeded(evaluated))` block)
with a temporary `process.stderr.write` of `evaluated.stdout/stderr`, run once,
read, REVERT. Do this FIRST when a run ends `unknown` — do not guess.

## Testing strategy — what hermetic tests can and cannot catch

Test owners: `skills/test-runner/` (the runner) and the `tdd` skill (red-green
discipline). This section only names WHICH layer catches WHAT — it does not teach
test authoring.

- **Framework changes** (`src/*.ts`: dispatch, resume, gates, model): fully
  hermetic-testable, and should be. Fake the run state, count evals, assert the
  terminal state. This is where hermetic tests are load-bearing.
- **Reviewed-action pure logic** (date parsing, wrong-week guard, selector
  matching, fill/click sequencing): hermetic-testable against a SYNTHETIC DOM
  fixture (a hand-built element tree resembling the target page). Worth it for the
  logic — but it CANNOT tell you the real portal's DOM shape.
- **The real DOM contract** (what selectors/routes/field-models the portal ACTUALLY
  uses): NOT hermetic. Discover it via CDP against the live portal FIRST
  (gotchas G4/G7/G9), then encode it. Tonight's worst bugs (rxg.workDate1 vs
  startDateTime, the SPA route, window.open nav) were real-DOM mismatches a
  hermetic test with a wrong fixture would have PASSED while the live run failed.
- **Runbook structure** (step order, postconditions): `runbook validate` + a live
  run; little hermetic surface.

Order that actually works: **CDP-discover the real DOM → author the action →
hermetic-test its pure logic against a fixture that MATCHES the discovered DOM →
promote → activate → prove LIVE.** A green hermetic suite is necessary but never
sufficient for a runbook/action — only a `confirmed` live run proves it
(gotcha G19).

## Reviewed-action authoring (the .js bytes + candidate)

### G1. Async actions must not become top-level await (framework-level)
The action wrapper is `async ({ inputs }) => <result>`. The runtime invokes it via
`reviewedActionPayload` which must emit a single async-IIFE EXPRESSION, e.g.
`(async () => { const action = (<script>); return await action({inputs}); })()`.
A bare `const action = (...); await action({...});` is TOP-LEVEL await, which the
native eval harness rejects with `SyntaxError: await is only valid in async
functions and the top level bodies of modules` — every async action dies before
its body runs, surfacing as `task_run_effect_unknown`. If you write a new
async-capable evaluation seam, wrap invocation in an async IIFE.

### G2. Navigation URLs in action source must be STATIC literals
The capability auditor (`browser-use-reviewed-action-authoring.ts`, rule
`action_capability_navigation`) requires any navigation target to resolve
statically to the candidate origin. `window.location.href = base + path` (string
concatenation) FAILS the audit ("navigation must resolve statically to the
candidate origin"). Use one complete literal string:
`window.location.href = "https://host/full#/route"`. Also: `open(` / `window.open`
/ `history` are flagged as unbounded navigation — avoid them in action bytes.

### G3. A mutation action REQUIRES a postcondition, field is `required_postcondition`
Candidate field is `required_postcondition` (NOT `postcondition`). A mutation-class
action without one is refused (`action_postcondition_required`). Valid kinds:
`url-equals`, `url-starts-with`, `element-visible` (selector). Prefer
`element-visible` on a stable element over `url-equals`/`url-starts-with` when the
action navigates within an SPA — the URL can change after the action acts (see G6).

### G4. Read grid dates from the authoritative per-row field, not a shared input
FastTrack timesheet rows expose their date in `rxg.workDate1`, present whether the
grid is empty OR filled. `rxg.startDateTime` holds a TIME-of-day ("09:00") once
filled — reading the date from it returns "" on a filled grid, making every row's
date unreadable (`row_dates_unreadable` / date mismatch). Read the dedicated date
model first, then fall back. General lesson: read each row's own authoritative
value model, never infer a date from a value input that changes shape when filled.

## Runbook step structure

### G5. Every ref-mutating action step needs a `snapshot` immediately before it
The agent-browser lane refuses (`task_run_lane_refused`: "A fresh task-local
snapshot is required immediately before ref mutation") if a mutation-class action
runs without a fresh snapshot right before it. Note: actions can be `effect_class:
mutation` even when they look read-only (verify actions that click/read refs are
mutation-class). Pattern: `... snapshot, action, snapshot, action, ...` — one
snapshot per action step. Missing a snapshot before ANY action step breaks it.

### G6. An action's postcondition is checked AFTER the action runs — on the page it LANDS on
If the action navigates (e.g. opens a row into an edit view), the post-action URL
differs from the pre-action URL. A `url-starts-with <search route>` postcondition
FAILS if the action ends on the edit route, even though the action succeeded
(`task_run_not_achieved`). Use `element-visible` on a stable element of the final
page, or match the URL the action actually ends on.

## Single-page-app (SPA) navigation

Client-rendered apps (Angular/React/etc.) make navigation the hardest part of
authoring. These principles are general; the FastTrack (Angular) specifics that
prove them live in the worked-example section.

### G7. Discover the real route/DOM via CDP — never assume or hand-encode
Whatever the app's URL scheme (hash routes, base64 segments, opaque ids), read the
ACTUAL live values via CDP (`/json` for tabs, `ws://.../devtools/page/<id>` +
`Runtime.evaluate`) after a human navigates there once. Do not infer a route
encoding or "clean up" a URL — assumptions about the encoding are how you build an
action that navigates to a route the app rejects. (FastTrack example: a route that
looked like padded base64 had a genuine trailing suffix; stripping it broke nav.)

### G8. In-place URL/hash mutation is often intercepted by the SPA router
Setting `window.location.href = "...#/route"` from an already-loaded SPA is
frequently caught by the client router and bounced (to home, or nowhere). A FULL
document navigation boots the app fresh on the target. Robust options: (a) point
the runbook's `open` STEP directly at the target URL (a real navigation), or
(b) force a reload — but a reload kills the action's execution context, so prefer
the open-step. Verify which behavior the app has via CDP before relying on either.

### G9. The portal's own nav controls may not be programmatically clickable
A visible "link" may be a framework click-handler with `href=null` (e.g. Angular
`ng-click`) that internally does `window.open(...)` (a new tab / fresh load), so
`.click()`, scope `$eval`, and even a trusted CDP mouse click may NOT navigate the
current tab. Don't depend on driving the app's own menu from an action; drive
navigation via the runbook `open` step (G8) to the discovered target URL (G7).

## Operator / promotion / activation cycle

### G10. Promotion binds to the COMMITTED git tree — commit source before promoting
`action promote` reads the committed tree. If you `action apply` a changed source
but do not commit, promote fails `action_already_promoted` (it sees the old
committed receipt) or binds to stale bytes. Order: edit source -> rebuild candidate
-> `action validate` -> `action apply --expected-record-digest <sha>` -> COMMIT ->
`action promote` (Touch ID) -> commit the receipt -> `runbook activate`.

### G11. `action apply` on an existing action needs `--expected-record-digest`
Replacing a promoted action requires the concurrency guard: compute
`record_digest = sha256(JSON.stringify(record))` (use `jq -c` on the exact registry
`.record` object) and pass `--expected-record-digest`. Without it:
`action_replacement_digest_required`.

### G12. Changing ONLY the postcondition still clears the promotion receipt
The promotion binds to the whole record, not just the byte digest. Even if the
action `.js` byte digest is unchanged, changing `required_postcondition` marks the
record unpromoted -> re-promote (Touch ID). (The runbook step's `expected_digest`
does NOT change, since it references the byte digest.)

### G13. `promotion_history` is AUDIT evidence, not activation authority
Only `record.promotion_receipt` grants activation authority. `promotion_history`
is append-only audit (it retains superseded digests, legacy `approver_ref`
entries). Do not treat history entries as current authority — a fix earlier this
session made the activation verifier stop reading history as authority
(`runbook_action_promotion_invalid` otherwise).

### G14. A `src/*.ts` change does NOT change the catalog digest; a runbook/action change does
The catalog digest is computed over the runbook/action SOURCE tree. Fixing engine
code (`src/*.ts`) needs NO re-activation (the active generation picks it up). Only
changing `runbooks/**` or `actions/**` requires a fresh `runbook activate`.

## Run lifecycle operations

### G15. Resuming a run needs `--handoff <fresh path>`
`runbook run --run <id>` alone errors `usage_error: requires --handoff`. Mint a
fresh handoff: `browser-connect connect agent-browser --json --run-id <id> > <path>`
(check `.data.outcome == "verified"`), then
`runbook run --run <id> --handoff <path>`.

### G16. A timed-out foreground run holds a dispatch LEASE
Killing a foreground `runbook run` at a tool timeout leaves a dispatch lease held
(~2.8 min TTL) -> next attempt errors `lease_held`. Run live browser sessions in
the BACKGROUND (they can take minutes) and do not kill them; if you hit
`lease_held`, wait for the TTL, re-mint the handoff, resume.

### G17. Exactly ONE admissible FastTrack tab, or `agent_browser_target_ambiguous`
Multiple portal tabs -> the run cannot pick one. Close extras via
`curl http://127.0.0.1:9242/json/close/<tab-id>`, keep one. (CDP diagnosis opening
tabs is a common cause of leaving two.)

### G18. `run cancel` clears stale nonterminal runs blocking `activate`
`runbook activate` refuses while any prior-generation mutation-capable run is
nonterminal (`activation_blocked_by_run`). `run cancel --run <id>` moves a
non-dispatched run to terminal `not-achieved` (refuses if `mutation_dispatched`).
Cancel stale `awaiting-*`/`needs-human` fasttrack runs before re-activating.

## Method / discipline

### G19. Prove through the RUNBOOK, never by hand-filling via CDP
CDP is for DIAGNOSIS ONLY (read the live DOM, find the real selector/route/reason).
A clean `runbook run` reaching a confirmed terminal state is the only "proven".
Hand-filling the form via CDP produces a filled page but proves nothing about the
action/runbook and hides the real bug.

### G20. The submit flow gates on explicit human approval + a screenshot
The `awaiting-approval` gate captures an adapter-agnostic screenshot
(`screenshot_media`) attached to the run; the human reviews it, then
`run approve --run <id> --continuation complete-submit-approval --artifact <id>`
records approval. Only then does the submit dispatch. Never approve on the user's
behalf; never bypass the gate for an irreversible action.

## Approval-gated submit — resume + dispatch (learned after G1–G20)

### G21. After `run approve`, the run is `running@N` — resume it, don't re-run fresh
`run approve` only RECORDS approval (sets state `running`, bumps next_step, adds an
approvals entry with `approved_at_epoch_ms`). It does NOT dispatch. To execute the
submit you must RESUME the SAME run: `runbook run --service .. --flow .. --run <id>
--handoff <fresh handoff> --input-file ..`. Starting a fresh run re-enters at the
gate. And resume REQUIRES `--handoff` (usage_error otherwise — see G15).

### G22. The post-approval dispatch is a MULTI-STEP resume loop
The tail (snapshot -> submit action -> snapshot -> verify-submitted) does NOT run
in one resume call. Each resume advances a bounded number of steps and returns
`running@N`; call `runbook run --run <id> --handoff <fresh>` AGAIN to advance
further, until terminal (`confirmed`/`not-achieved`/`unknown`). A `running@N` return
with no error is "more resumes needed", not a failure — but watch for G23.

### G23. An approved run that never sets `dispatch_started_at_epoch_ms` is WEDGED
Symptom: repeated resumes return `running@N`, and the approval reads
`{approved: true, dispatched: false}` (dispatch_started never set). Root cause seen:
the human-identity attestation expired on the resume and returned a blocked result
WITHOUT persisting the blocked transaction, so execution never reached
mark-dispatch. The fix is framework-side (renew + persist the attestation so the
approved dispatch proceeds). If you see `dispatched:false` stuck across resumes,
it's this class — a code bug, not an operator error.

### G24. Submit and verify-submit are SEPARATE steps — "submitted but not verified"
The submit action fires at its own step; `verify-submitted` is a LATER step. The
submit can SUCCEED (portal shows Submitted) while the run reports `not-achieved`
because verify-submitted failed to read the result. Always CDP-confirm the portal's
real state before believing "not-achieved" means "didn't submit". Conversely, never
claim submitted just because the run advanced — check the portal.

### G25. Post-submit verification runs on the DETAIL page, not the search list
After Submit, FastTrack navigates to the submitted-timesheet DETAIL view (title
"Time - Submitted Timesheet", url hash `submittedTimesheet`, a `Status: Submitted`
field) — NOT back to the search page with a "Submitted" tab. A verify action that
only checks the search-tab/row fails there. Recognize the detail page (title / url
route / Status field) as the primary signal; keep the search path as fallback.
General: a mutation action's verifier must match the page the mutation LANDS on
(cf. G6 for postconditions).

### G26. A dispatched-but-stuck run can't be cancelled and blocks activation
Once `mutation_dispatched: true`, `run cancel` refuses ("inspect its external effect
instead") — by design: a dispatched submit may have completed server-side even when a
CDP page read shows nothing, so the write-ahead `mutation_dispatched` guard must hold.
If such a run is genuinely wedged (`running@N`, nothing submitted, no continuation, no
runtime action), it blocks `runbook activate` (`activation_blocked_by_run`).
Do NOT hand-edit `run.json` to clear the state — that bypasses the write-ahead guard and
can let a new generation proceed while a delayed or server-side submit outcome is still
uncertain. Prefer a fresh run over reusing a wedged run id. A dispatched-but-uncertain
run needs an audited reconciliation operation (that proves the remote submit outcome
before clearing the block), not a manual state edit — tracked as a follow-up; until it
exists, escalate a wedged dispatched run rather than editing durable run state by hand.

### Operating note (not a runbook gotcha): dispatch codex worker prompts via STDIN
`codex exec ... < prompt.txt`, never as a giant positional arg `"$(cat prompt)"` —
the arg form hangs at "Reading additional input from stdin..." doing nothing.
(Memory: `codex-exec-prompt-via-stdin`.)
