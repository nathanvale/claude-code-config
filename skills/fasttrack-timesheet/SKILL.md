---
name: fasttrack-timesheet
description: "Prepare a FastTrack timesheet draft and submit only after screenshot approval."
disable-model-invocation: true
---

# FastTrack Timesheet

Conversational front end for the FastTrack timesheet runbook. This skill turns a
plain request ("fill last week, 9 to 5 Mon to Thu") into the exact structured
input the runbook consumes, runs the fill, and — only on explicit approval after
showing a screenshot — runs the submit. It owns the ASKING and APPROVAL; it does
not reimplement browser mechanics.

Owner of the mechanics (delegate, never copy its contracts): the `browser-use`
skill and its `fasttrack/fill-week` + `fasttrack/submit` runbooks.

## Safety gate (fail-closed)

- Never guess the week or the hours. If either is unstated or ambiguous, ask one
  question with a sensible default before building the input.
- Before the first live fill, explain that it changes a portal draft but does
  not submit, summarize the week, hours, and defaults, then obtain explicit
  confirmation. A draft remains editable before submission; it is not
  read-only.
- Never submit without BOTH: a screenshot of the filled timesheet shown to the
  user, AND the user's explicit approval after seeing it. Treat submit as an
  externally consequential action.
- Never fill or submit a week the user did not name. The runbook's own week-guard
  refuses a wrong-week grid — do not try to bypass it.
- Submit only when the user says to. If they say "not yet" / "only draft", stop
  after fill and report the draft state.
- The submit reviewed action must be promoted (Touch ID) before a live submit; if
  it is unpromoted, stop and tell the user to promote it — never work around the
  gate.

## Gather (ask only what is missing)

Collect, in order, using defaults; ask one question per genuinely missing/ambiguous item:
- **Week** — the Mon–Sun the timesheet covers. "this week" / "last week" resolve
  from today's date. Default: the current week.
- **Work days + hours** — per day start/end. Default: Mon–Fri 09:00–17:00.
- **Breaks** — default: one 12:00–13:00 lunch (confirm if it matters to the total).
- **Attendance type** — default: "Standard".
- **Account / final action** — default account "self"; final action "human-submit"
  (fill draft, human submits) unless the user asks to submit now.

State the assumed defaults you used; do not silently invent non-default values.

## Build the input

Write the `timesheet_run` input file the fill action reads. Its exact shape is
owned by the runbook input schema — read it live (`browser-use runbook schema` /
the fill-week runbook's declared inputs), do not restate fields here (they drift).
Write the file under the runtime private-input root as an owner-only file. Compute
dates from the named week; map "9 to 5" → 09:00/17:00. If unsure of the shape,
copy the structure of the last committed `timesheet_run.json` example.

## Run card

Delegate the mechanics to the `browser-use` skill — it owns the exact `runbook
run` command, the prerequisites (an ACTIVATED generation, the approval-broker env
for the Touch ID identity gate), and the connection. Read its run card; do not
restate the command here (it drifts). The service/flow is `fasttrack` /
`fill-week`, input `timesheet_run=<abs path>`.

The run reaches a Touch ID identity gate — tell the user to tap. On success the
timesheet grid fills (draft). Report what was filled (days + hours + total).

If the run fails on a prerequisite (broker env unset, catalog not activated, no
admissible tab), STOP and route the fix to the `browser-use` skill — do not work
around activation or the presence gate.

## Submit (only on explicit approval)

Owned by the `browser-use` `fasttrack/submit` runbook + its `run approve` surface.

1. The submit run halts at an `awaiting-approval` gate and surfaces an
   adapter-agnostic screenshot artifact of the filled timesheet.
2. Present that screenshot to the user and ask for explicit approval to submit.
3. Only if approved: complete the approval continuation (per the `browser-use`
   run card) and let the submit run.
4. Never approve on the user's behalf. "Looks good" without a clear go is not a go
   for an irreversible submit — confirm.

Owner of the submit action, approval gate, `run approve`, and screenshot artifact:
the `browser-use` `fasttrack/submit` runbook. Read its run card for the exact
approve/continuation commands; do not duplicate them here.

## Verify

- After fill: confirm the reported days/hours match what the user asked; if the
  run ended `unknown`, say so — do not claim a fill that was not confirmed.
- After submit: confirm the run reports a submitted state before telling the user
  it is submitted.

## First safe action

Resolve the target week from the user's words + today's date, list the defaults
you will assume, ask one question only if the week or hours are missing/ambiguous,
then build the input and run the fill card. Do not submit in the same step as fill.
