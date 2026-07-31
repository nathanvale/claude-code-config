# Browser Use Prototyper — Workflow

Read after the lane and questions are named and the harness is attached. The
`SKILL.md` invariants (secret-free, never-real-default-Chrome, lane-neutral,
served fixtures, throwaway) apply throughout.

## Two lanes

Same spike loop, same invariants, same toolkit — the lane only changes what a
question *is* and where the receipt goes.

- **Pre-build (falsify).** Question = a mechanic the plan cannot proceed without.
  Pass = *this is possible against real Chrome*. Receipt feeds `ce-plan`: proven
  → acceptance criterion, refuted → forced plan edit, unproven-but-needed → named
  open question. Run before/during `ce-plan`.
- **Post-build (accept).** Question = an acceptance claim the shipped code must
  satisfy — a new CLI feature invoked for real, an end-to-end flow driven against
  a fixture, a lane proven still neutral after the change. Pass = *the built thing
  does what the plan promised*. Drive the **actual implementation** (the new CLI
  command, the built runbook, the real seam) — not a stand-in for it. Run after
  `ce-work` implements a plan. A gap is a **bug against the implementation** (route
  to `diagnosing-bugs`) or a **plan-was-wrong revision**, not a silent pass. Match
  the spike to the plan's shape: a CLI-feature plan gets a CLI-invocation spike; an
  end-to-end delivery plan gets the full flow spiked to its gated boundary.

## The spike loop

1. **One question, one spike.** Each falsifiable question gets a pass/fail
   verdict and the exact call sequence that produced it. Do not bundle.
2. **Attach.** `browser-connect connect <adapter> --json` → take
   `data.endpoint.ws`. Drive through the `browser-use` CLI, or a flat-session
   CDP client (below) against that endpoint. The endpoint travels in the
   envelope — never hardcode `9222`.
3. **Serve the fixture.** Put HTML under `skills/browser-use/src/prototypes/YYYY-MM-DD-<question-slug>/`
   and serve it over `http://localhost:<port>` (Bun static server, below). Open
   it in Agent Chrome with the adapter, or `browser-connect run`.
4. **Falsify.** Drive the mechanic; assert the exact symptom (not "didn't
   crash"). Print the state after each action.
5. **Verdict + receipt.** Write `findings.md`: per question, PASS/FAIL, the exact
   CDP/CLI call sequence, and the plan edit it forces.
6. **Graduate.** Fold the receipt into the plan via `ce-plan`; a proven mechanic
   becomes an acceptance criterion, a refuted one becomes a plan edit. Capture
   the spike to a throwaway branch; `main` keeps only the decision.

## Falsification-first receipts

A receipt that only ever passes is worthless. Every proof must be **falsifiable
and shown to fire**:

- For a leak/safety claim, run a **planted-regression** variant (e.g. a child
  that echoes the secret) and confirm the sweep flips to VIOLATED. Only then does
  the clean pass mean anything.
- For a "works" claim, assert the specific committed state (a model value, a
  field length, a post-login marker) — not the absence of an error.
- Log any silent cap or dropped case; a spike that quietly narrows coverage reads
  as "proved everything" when it did not.

## Lane-neutrality proof

When a mechanic must be adapter-independent (the harness's core claim): run the
same spike once per adapter — `agent-browser`, `playwright-cdp`,
`chrome-devtools-mcp` — taking each one's `browser-connect connect <adapter>
--json` endpoint, and assert identical results. All three verify to the **same
Warm Chrome endpoint**; the custody/delivery layer binds by **CDP target id**,
not adapter page id, which is why it is neutral. If a spike behaves differently
per adapter, that difference is the finding.

Known trap: raw MCP adapter servers may hardcode `9222` and fail against Warm
Chrome — route through the harness envelope, not the raw server. Harness target
discovery is **http(s)-only**; a `file://` fixture yields zero candidates.

## Custody + auth discipline (secret-safe by construction)

- **Auth through `browser-use auth` where possible** — it owns the token
  lifecycle. Spikes use dummy values; a real login is operator-gated.
- **`op` reads flow op → child (fd 3, private pipe) → field.** The agent process
  never binds the secret to a variable it logs. Report shape only (kind + byte
  length), never the value.
- **Re-verify origin immediately before every secret step** — a wrong/redirected
  origin never receives the secret.
- **Sweep the agent-visible surfaces** (handle, child argv, child stdout/stderr,
  resume record) for the sentinel; the planted-regression variant must flip the
  verdict.
- **Field resolution:** role + accessible name → `backendNodeId` in the delivery
  session; the CDP target is resolved from `Target.getTargets` by URL, never an
  adapter tab id.
- **Bounded write is clear-then-insert** (select existing value, then
  `Input.insertText`); activation uses a trusted `Input.dispatchMouseEvent` or
  the real mouse-event sequence, not `element.click()`.

## Fixture + harness toolkit

Reusable scaffolding so a spike starts in minutes:

- **ngModel-equivalent fixture.** An HTML page whose "model" commits only on real
  `input`/`change` events (never a raw `.value` write) — so a spike proves a
  framework binding actually commits. Add counters for input/change/keydown and a
  `window.__probe()` global to read state via `Runtime.evaluate`.
- **Served http fixture.** A Bun static server over the prototypes dir on
  `http://localhost:<port>` (fixtures must be http, not file://).
- **Flat-session CDP client.** A minimal WebSocket client:
  `Target.getTargets` → `Target.attachToTarget {flatten:true}` →
  `Runtime.enable`/`DOM.enable`/`Accessibility.enable` → drive. A second such
  client can attach alongside the adapter's own connection.
- **Six-shape login rig.** One page with label-wrapped, `aria-labelledby`,
  placeholder-only, iframe-embedded, shadow-DOM, and `for`/`id` login fields — all
  surface identically to the accessibility tree, proving generic login by
  role+name with no per-shape code.
- **Timesheet-grid rig.** An Angular-style `tr[ng-repeat]` grid with
  `rxg.startDateTime`/`rxg.endDateTime`/`rxg.attendanceTypeId` and query-param
  variants (clean / fortnight-superset / duplicate-date / unreadable-date) to
  prove fill-by-date and the fail-closed guards.

## Auto-capture + graduation

- **Save** each spike to `skills/browser-use/src/prototypes/YYYY-MM-DD-<question-slug>/` with its
  `findings.md`.
- **The findings note is the single source** — one note per prototype session.
  Pre-build: `ce-plan` folds it in wholesale, citing proven receipts and dropping
  refuted assumptions. Post-build: it is the **acceptance receipt** attached to
  the implementation (link it from the PR or the plan's Verification Contract).
- **Graduate by lane:**
  - *Pre-build:* a proven mechanic → plan acceptance criterion; a refuted one →
    forced plan edit; an unproven-but-needed mechanic → named open question, not a
    silent assumption.
  - *Post-build:* every acceptance claim PASS → the implementation is proven end
    to end for that claim; any FAIL → a bug filed against the implementation
    (`diagnosing-bugs`) or, if the plan itself was wrong, a plan revision. Never
    let a post-build FAIL pass as "close enough."
- **Capture to a branch, not `main`.** Commit the spike to a throwaway branch and
  leave a pointer; `main` keeps only the validated decision (and, when useful, a
  worked-example spike dir under `prototypes/`).

## When NOT to spike

- The mechanic is already exercised by shipped code with tests — read those
  instead.
- The question is pure product/scope, not a browser mechanic — that is `ce-plan`
  / `ce-brainstorm`, not this.
- A real credential into a real portal is required — that is operator-gated;
  prove the mechanic secret-free against a fixture and stop at the boundary.
