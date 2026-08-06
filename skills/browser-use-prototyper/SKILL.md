---
name: browser-use-prototyper
description: "Prove browser mechanics with a throwaway harness spike — before implementing (falsify the plan's risky CDP writes, login/auth, credential delivery, adapter/lane behavior) AND after implementing (acceptance-spike the built CLI feature or end-to-end flow against real Chrome). Use during ce-plan and after ce-work."
role: tool-workflow
---

# Browser Use Prototyper

Prove browser mechanics with a throwaway spike against real Agent Chrome,
secret-free — at **both ends** of a plan's life. Guessing wastes hours of build,
review, and tokens; a spike settles it in minutes.

- **Pre-build (falsify).** Before implementing, prove the plan's risky mechanics
  actually work, so a plan never rests on an unproven CDP write, login/auth flow,
  credential delivery, or adapter/lane assumption. The receipt feeds `ce-plan`.
- **Post-build (accept).** Once a plan is implemented, spike the *built* thing to
  prove it does what the plan promised — a new CLI feature exercised end to end,
  a login/fill flow driven against a fixture, a lane proven neutral. The receipt
  is acceptance evidence, not a design question.

Use whenever a plan — being planned OR just implemented — touches browser
mechanics: a CDP field write, a login/auth flow, credential delivery, adapter or
lane behavior, target discovery, a new browser-facing CLI surface, or a
form/timesheet fill.

## First safe action

1. **Pick the lane.** Is the plan still being planned (pre-build falsify) or
   just implemented (post-build accept)? The lane sets what "pass" means:
   *the mechanic is possible* vs *the shipped code does what the plan promised*.
2. Name the falsifiable questions — pre-build: the mechanics the plan cannot
   proceed without; post-build: the acceptance claims the implementation must
   satisfy (one pass/fail each).
3. Attach the real harness: `browser-connect connect <adapter> --json` for the
   verified endpoint; drive through the `browser-use` CLI (or the built CLI
   feature itself, post-build) or a flat-session CDP client. Never a convention
   port, never the real default Chrome.
4. Spike one question at a time in `skills/browser-use/src/prototypes/YYYY-MM-DD-<question-slug>/`,
   secret-free, against an **http-served** fixture.
5. Write a `findings.md` receipt (pass/fail + exact call sequence per question).
   Pre-build it feeds `ce-plan`; post-build it is the acceptance receipt attached
   to the implementation (and any gap becomes a bug or a plan-revision).

Then read `references/prototyper-workflow.md` for the spike loop, the two lanes'
graduation steps, the fixture + CDP toolkit, the custody/auth discipline, and the
lane-neutrality proof.

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
