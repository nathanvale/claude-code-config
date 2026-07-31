---
name: browser-use-prototyper
description: "Falsify a plan's risky browser mechanics with a throwaway harness spike before implementing. Use before or during ce-plan for CDP writes, login/auth, credential delivery, adapter/lane behavior, or timesheet/form fills — prove it works on real Chrome first, don't discover after hours of build that it doesn't."
role: tool-workflow
---

# Browser Use Prototyper

Prove the risky browser mechanics of a plan **before** implementation, against
real Agent Chrome, secret-free. A plan that rests on unproven CDP/login/custody
behavior burns hours of build + review + tokens before anyone learns it does not
work. Spike first; fold the receipt into the plan.

Use when a plan (or a `ce-plan` run) depends on browser mechanics no shipped
code has exercised: a CDP field write, a login/auth flow, credential delivery,
adapter/lane behavior, target discovery, or a form/timesheet fill.

## First safe action

1. Name the falsifiable questions — the exact mechanics the plan cannot proceed
   without (one pass/fail each).
2. Attach the real harness: `browser-connect connect <adapter> --json` for the
   verified endpoint; drive through the `browser-use` CLI or a flat-session CDP
   client. Never a convention port, never the real default Chrome.
3. Spike one question at a time in `skills/browser-use/src/prototypes/<date-slug>/`,
   secret-free, against an **http-served** fixture.
4. Write a `findings.md` receipt (pass/fail + exact call sequence per question).
   That receipt is `ce-plan`'s single source.

Then read `references/prototyper-workflow.md` for the spike loop, the fixture +
CDP toolkit, the custody/auth discipline, lane-neutrality proof, and the
graduation-into-plan step.

## Invariants (fail closed)

- **Secret-free.** Dummy values only. Real credentials are operator-gated. Auth
  goes through `browser-use auth` where possible; `op` reads flow through the
  custody child (bytes never enter the agent context); re-verify origin before
  every secret step.
- **Never the real default Chrome** — Agent Chrome via `browser-connect` only
  (incident guard DDA-F26).
- **Lane-neutral where claimed** — a mechanic that must be adapter-independent is
  proven identically on agent-browser, playwright-cdp, and chrome-devtools-mcp.
- **Served fixtures** — `http://localhost`, not `file://`, or the harness
  discovery filter (http(s)-only) never sees the tab.
- **Throwaway** — spikes are captured to a branch; only the validated decision
  graduates into the plan.

## Owners (link, never restate their contracts)

- Attach / verified handoff / repair: `runtime/browser-connect` via
  `browser-connect connect --json`.
- Task routing, runbooks, auth: the `browser-use` CLI (`browser-use guide`,
  `browser-use auth`).
- Custody seam + secret-never-seen contract:
  `skills/browser-use/src/browser-use-confidential-field-delivery.ts`.
- Throwaway-build discipline (the general pattern): the `prototype` skill.
- Fold receipts into the plan: `ce-plan` (the findings note is its input).

## Next safe action

- Questions named, harness attached: read `references/prototyper-workflow.md` and
  run the spike loop.
- Spike passed: write the receipt, then hand off to `ce-plan` to fold it in.
- Blocked attaching: `browser-use guide --topic recovery`.
