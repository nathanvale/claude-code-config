# Confidential-delivery prototype findings (2026-07-31)

Throwaway spikes run against live Agent Chrome (via `browser-connect connect
agent-browser --json`) to falsify the unproven mechanics behind
`docs/plans/2026-07-31-001-feat-browser-use-confidential-delivery-wiring-plan.md`.
Secret-free except where noted. All spike artifacts are throwaway (session
scratchpad); this note is the single source for `ce-plan` to consume.

Six pieces proven. Each row is a design question the plan rested on, the verdict,
and the plan edit it forces (if any).

## 1. CDP write mechanics (second browser-level client)

- **Q1 second CDP client + flat-session attach** — PASS. A second WebSocket
  client attached to the browser endpoint alongside the agent-browser adapter and
  drove `Target.attachToTarget {flatten:true}`; both stayed live.
- **Q2 `Input.insertText` vs Angular binding** — PASS for `input`-bound fields.
  insertText fires a real `input` event and commits to an ngModel-equivalent; a
  raw `.value` write fires nothing. **Caveat:** insertText does NOT fire `change`
  (no blur) and inserts AT THE CURSOR (re-entered fields concatenate).
- **Q3 tab -> CDP target single-match** — PASS via `Target.getTargets` matched by
  exact normalized URL.
- **Q4 role+name -> exact node** — PASS. `Accessibility.getFullAXTree` (role +
  accessible name) -> `backendDOMNodeId` -> `DOM.resolveNode`; identity check
  `this === #field` true.
- **Q5 origin re-read before insert** — PASS. One `Runtime.evaluate` on the
  attached session returns top-frame origin/href cheaply (supports TOCTOU re-check).

Exact working sequence (per session, flat):
`Target.getTargets` -> `Target.attachToTarget{targetId,flatten:true}` ->
`Runtime.enable`/`DOM.enable`/`Accessibility.enable` -> `getFullAXTree` (match
role+name) -> `DOM.resolveNode{backendNodeId}` -> `Runtime.evaluate` (origin
re-read) -> `DOM.focus{backendNodeId}` -> **select-then-**`Input.insertText`.

**Identity facts:** agent-browser tab id (`t1`) is NOT a CDP target id; the
snapshot ref (`e3`) is NOT a `backendNodeId`. U3 must resolve the target from
`Target.getTargets`, and the field bridge must go through the AX tree in the
delivery child's own session.

**Plan edits forced:**
- U1 bounded action = **select-then-insert** (clear first), not bare
  `insertText`, or re-entered fields concatenate.
- U3: resolve target id from `Target.getTargets` by URL/origin (never the
  adapter tab id); field bridge = AX-tree -> backendNodeId.
- Open Question 1 resolved for `input`-bound fields; keep the U6 hermetic
  FastTrack fixture as the final arbiter for whether a `change`/blur dispatch is
  also required.

## 2. Custody choreography control flow

Drove the real `deliverConfidentialFields` contract shape through all paths with
fakes for the four unbuilt custody layers and a real CDP insert as the deliver
hook. Real choreography suite green (18/18), so the inline mirror tracks shipped
logic.

- Happy path (password + otp-current) -> resume directive with
  `discard_stale_refs`/`require_fresh_identity_basis`, non-secret shapes only.
- Human challenge -> hard stop before any secret access, field untouched.
- Target digest drift at reproof -> `target-proof-invalid`, blocks before mint.
- Unpermitted field -> `unsupported-method`.
- Missing token -> `missing-token`, no write.
- Helper crash after write -> `capability-loss`, `external_effect_possible:true`.
- Handle single-use -> second redeem rejected (`replay`).

**Verdict:** the U1->U6 control flow is sound; the live CDP layer slots under the
`deliver`/`reproveTarget` ports without contract friction. No plan edit forced.

## 3. Generic login across structural shapes (LOGIN NEEDS NO PER-PORTAL SCRIPT)

One fixture, six structurally different login shapes: label-wrapped,
`aria-labelledby`, placeholder-only, **iframe-embedded**, **shadow-DOM**, and
Oncore-style (`for`/`id`, label above). The accessibility tree flattened all six
to identical `textbox "Username"` / `textbox "Password"`. The adapter filled all
twelve fields by accessible-name ref alone; every one committed via input/change
(incl. iframe + shadow DOM).

**Product decision this establishes:**
- **Login is generic.** An LLM + adapter reasons over the AX tree and logs in;
  there is NO login script for FastTrack, Oncore, or anything. FastTrack and
  Oncore are just "one of the shapes."
- The only per-portal artifacts are a **binding** (which credential -> which
  origin; a trust declaration, not code) and an optional **timesheet runbook**
  (a post-login fill cache, never login).

**Plan edits forced:** drop any per-portal LOGIN artifact from the plan;
`fill-week.js` is a *timesheet* runbook, correctly. Acceptance: "generic login
proven across FastTrack-style and Oncore-style shapes" — done.

## 4. Self-optimizing runbook lifecycle

State machine keyed by `portal::task::framework`, versioned, with a recorded cost
baseline. Three paths proven:
- **Cold miss** -> LLM does it live -> distill + save a v1 runbook.
- **Warm hit (clean)** -> replay cached fast-path, no re-distill (cheap).
- **Warm + improve** -> metrics-gated: if this run was slower than baseline /
  deviated / retried, re-distill a v2 from what actually worked.

Each portal/framework keeps an independent, independently-versioned runbook.

## 5. Speed-first: optimization is OFF the critical path

Corrected ordering, three distinct moments:
1. **Critical path** — run as fast as possible, return outcome + measured
   duration ("done, took Xs"), record the duration (cheap). User leaves.
2. **Background (user gone)** — a detached worker distills/re-distills. The user
   awaited none of it.
3. **Next visit** — the optimized runbook is already waiting; the first warm call
   is fast (never earned by a second slow run).

Modeled speedup: cold 7200ms -> warm 2600ms -> after drift-reopt 1500ms. A
distilled runbook must be **materially faster than cold** (skips reasoning) or it
is not worth writing.

**Plan contract this establishes:**
- Critical-path invariant: execute -> return outcome + duration -> done. Nothing
  that makes next time faster runs before the user is served.
- Duration recorded on the critical path; runbook built in the background off it.
- Background optimize queued only when `shouldOptimize` fires (cold / drift /
  slower-than-baseline); a clean steady-state visit queues nothing.
- Acceptance: distilled runbook is materially faster than the cold run.

## 6. Secret-never-seen custody seam (SECURITY HEART)

Two real processes against live Chrome:
- **Agent process** picked the field (role+name -> backendNodeId), held only an
  opaque handle (no value slot), spawned the child, received outcome + shape.
- **Disposable child** was the only process to touch the bytes: read the secret
  from a private pipe (fd 3), one bounded insert, reported `{ok, shape:{field_len}}`,
  exited.

**Proof:** swept every agent-visible surface (handle object, child argv, child
stdout/stderr, resume record) for the delivered sentinel. Sentinel **landed in the
page field** and was **absent from every agent-visible surface**. A planted-leak
variant (child echoes the secret to stdout) flipped the verdict to SEAM VIOLATED
and pinpointed `child_stdout` — so the sweep is falsifiable and fires on a real
leak.

**Plan contract this establishes (U1):**
- Intelligence/custody split is mechanically enforceable at a real process
  boundary: the LLM decides the field; bytes flow op-child -> delivery-child ->
  page, never into the agent context.
- The return contract has no value slot (outcome + `field_len` shape only).
- Leak-sweep is an acceptance test (argv + stdout + stderr + handle + resume
  record); a planted-regression variant MUST flip the verdict (already in U1's
  test scenarios).

## 7. Real 1Password vault path (BOTH portals, real secret, never seen)

Ran the real vault path against the "Browser Automation" vault for both real
items, delivering into a SCRATCH page (not the real portal).

- **Cold (no token)** — a bogus `OP_SERVICE_ACCOUNT_TOKEN` makes `op` fail closed
  (`failed to DecodeSACredentials`); no vault access. Fail-closed proven.
- **Token validated without disclosure** — `op account list` confirms a session
  without printing the token.
- **Resolve real items (metadata only)** — Fasttrack360
  (`6he7gmnrc54ssdm7fzzvk4rmne`, manpowergroup.fasttrack360.com.au) and Oncore
  (`br3dx7qe6loo264sonmtj2czny`, iteraterecruitment.oncoreservices.com). Both
  expose `username` (STRING) + `password` (CONCEALED), values present. No secret
  bytes read at resolution.
- **Deliver via custody seam** — `op read op://VAULT/item/password` piped straight
  into the delivery child's fd 3; child inserts into the scratch Password field
  and reports shape only. FastTrack `field_len:19`, Oncore `field_len:8`; the
  child's reported length equalled the scratch field's length, and the agent
  process saw only that number. Both: **VAULT DELIVERY OK**.
- **Cleanup** — scratch field re-read as length 0 after; no real secret lingers.

**What this settles:** the vault token setup works end to end for both real
portals — cold-fail-closed, validate-without-disclosure, resolve-real-item,
fetch-as-handle, deliver-secret-never-seen. The agent never bound the password to
a variable; `op read` -> child fd 3 -> field.

**Plan note:** this is the U2/U1 path exercised with the real `op` and real vault
items, minus the supervisor process (the spike used a bash pipe where U1 uses the
supervisor `deliver` op + `runPrivatePipe`). The delivery mechanics and custody
boundary are proven; U1 replaces the bash wrapper with the signed supervisor.

## 8. Unhappy-path vault resolution (all fail closed, real vault)

Against the real vault, every failure mode refuses BEFORE any secret read, each
with a typed blocked cause matching the plan's vocabulary:

- Bogus service-account token -> `missing-token` (op `DecodeSACredentials`).
- Non-existent item id -> `revoked-binding` (op `"…" isn't an item`).
- Real item, field not populated (asked `otp-current`) -> `unsupported-method`.
- Real item + real field, observed origin outside allowed set -> `origin-mismatch`
  (refused before the secret leaves custody — the phishing/redirect guard).
- Happy control (real item + real field + correct origin) -> deliverable.

All correct. Origin-mismatch refusing pre-read is the load-bearing safety case:
a wrong/redirected origin never receives the secret.

## ACCEPTANCE CRITERIA (must hold in the built product, not just the spikes)

- **Real login MUST route through the `browser-use auth` product surface
  (U1/U2: supervisor `deliver` op + `fetchCredentialField` handle + signed
  delivery child) — NOT the prototype scaffolding.** The 2026-07-31 live Oncore
  delivery used a throwaway `op read | custody-child` bash wrapper and a
  hand-rolled CDP client; that path is a de-risking stand-in ONLY. The shipped
  path must be `browser-use auth`, with no raw `op read` in a wrapper and no
  agent-process CDP client touching the field.
- **Full product is autonomous, zero user interaction.** The prototype's
  human-clicks-Sign-In step is spike scaffolding standing in for the not-yet-built
  autonomous submit; the product performs login + submit hands-off via U1. The
  manual click MUST NOT appear in the product.
- **Leak-sweep gate:** the U1 delivery path must pass the sentinel sweep
  (argv + stdout + stderr + handle + resume record) with a planted-regression
  variant flipping the verdict — carried over from finding 6.
- **Distilled runbook materially faster than cold**, or it is not written
  (finding 5).
- **Every unhappy vault case fails closed with its typed cause** (finding 8),
  including origin-mismatch refusing before any secret read.

## 9. Lane-neutral custody delivery across ALL adapters (KILLER FEATURE)

Proved plan R5/KTD3 live: one confidential-delivery seam, many lanes. For each
adapter, took the endpoint `browser-connect connect <adapter> --json` verified,
ran the SAME custody child against a scratch Password field:

- **agent-browser**, **playwright-cdp**, **chrome-devtools-mcp** all verified to
  the SAME Warm Chrome endpoint (`ws://127.0.0.1:9242/devtools/browser/88795d15…`).
- All three delivered identically (`field_len:31`), secret unseen, zero leak to
  the agent. Verdict: **LANE-NEUTRAL**.

**Why this is the product's moat — three concerns cleanly decoupled:**
- **Lane** (which adapter automates) — swappable; delivery is endpoint-based and
  does not depend on the adapter.
- **Intelligence** (LLM reasons out any login shape live) — proven across Oncore
  single-page and FastTrack multi-step/unlabelled.
- **Custody** (vault -> child -> field, never through the agent) — proven with
  real ManpowerGroup + Oncore credentials, secret-never-seen.

No per-adapter security model: a new lane inherits secret-safe delivery for free.
The real happy-path logins were verified live 2026-07-31: FastTrack (title
"FastTrack Application", login form gone) and Oncore, both via the custody child,
agent never holding bytes; operator clicked final submit (spike scaffolding per
the acceptance criteria above).

## Login pages: the harness must assume NOTHING (real-portal finding)

Two real portals, two incompatible login shapes, discovered live 2026-07-31:

- **Oncore** — single page; fields labelled `"User Name:"` / `"Password:"`
  (with colons); submit `"Log In"`.
- **FastTrack** — **username-first multi-step**: one **unlabelled** textbox
  (`textbox ""`, no accessible name) + a `"Next"` button; password appears on a
  LATER screen. A role+name matcher finds nothing here.

**Product consequence:** the login engine must hardcode NOTHING — not field names,
not "one page," not "fields co-present," not "every field has an accessible name."
This is the concrete case for **LLM-driven login**: the LLM reads the live snapshot
each step and reasons ("one text field next to a Next button = username; fill,
advance, then password"), rather than a per-portal script or a fixed matcher.
A resolve *strategy* (by-name / only-textbox / password-type / advance-then-fill)
should come from LLM reasoning over the live page, per step — not baked in.

**Plan edit forced:** the generic login flow must support multi-step
(fill -> advance -> fill) and an unlabelled-field fallback (LLM reasons from
page structure when role+name is absent). Delivery re-verifies origin before
EACH step's secret.

## Credential enrollment (no vault item yet) — NEXT-VERSION feature, not this plan

Open product question raised 2026-07-31: first-time automation against a new
portal has NO vault item, so `fetchCredentialField` fails closed
(`revoked-binding`/`item-missing`). Correct for THIS plan, but a dead end for the
user. Turning it into a feature = **credential capture / enrollment**, deliberately
OUT OF SCOPE here:

- The custody invariant must survive inversion: the user's typed credentials must
  be captured through a **1Password-owned input surface** (op CLI hidden prompt,
  or the 1Password app), which writes the vault item. The AGENT must never collect
  or hold the typed bytes — it only triggers "enroll this login" and waits for the
  item to appear in the vault.
- Do NOT let the agent gather username/password from the user to store them —
  that routes plaintext through the agent, the exact leak the product forbids.
- Scope as a separate v-next feature; keep this plan's item-missing behavior
  fail-closed.

## 10. Timesheet FILL correctness + fail-closed (the OTHER half of the product)

Proved the fill half (we'd proven login/delivery, never the fill) against a
served Angular grid fixture mirroring the real `tr[ng-repeat]` + `rxg.startDateTime`
/`rxg.endDateTime`/`rxg.attendanceTypeId` DOM. Fill is BY DATE (never blind
weekday index), stops before submit, and every fail-closed guard fires:

- **clean_week** -> fills Mon-Fri on exact calendar dates (Mon-Thu 09:00-17:00
  Standard, Fri 09:00-15:00 Overtime via dropdown), `submitted:false`. Committed
  model verified per-date.
- **wrong_week** (fortnight superset grid) -> refuses `wrong_week_open`.
- **duplicate** (two rows share a date) -> refuses `duplicate_row_date`.
- **unreadable** (row dates not readable) -> refuses `row_dates_unreadable`.

Mirrors the shipped `fill-week.js` guards. **Settles:** the fill half is correct
and fail-closed; the product never blind-fills a wrong-week/duplicate/ambiguous
grid. Fixture served over http (per finding-9 discovery lesson).

## 11. Multi-step / OTP login engine (no hardcoded flow)

Proved an LLM-driven step engine against a served multi-step fixture
(username -> password -> otp -> done, FastTrack-style + a 2FA screen). Each
iteration: snapshot -> classify the current step from the visible textbox name ->
deliver the matching vault field via the custody child (secret-unseen) ->
re-verify origin (R14) -> advance -> re-snapshot. No hardcoded sequence.

Result: walked `username -> password -> otp -> signed-in`; all three fields
committed via events; origin re-verified before EVERY secret; delivered shapes
only (`field_len` 14/15/6), never values. **Settles:** login handles arbitrary
step sequences incl. OTP/2FA by reasoning per-screen; `otp-current` delivery slots
into the same custody seam. Extends the live FastTrack multi-step finding.

## 12. Runbook distill is REAL (recorded trace -> runnable JS, materially faster)

The lifecycle spike (finding 4/5) FAKED the distill; this proves it. A cold run
filled the timesheet by per-cell reason-then-act (**20 CDP round-trips**, 20 trace
steps). The recorded trace distilled into a single in-page JS fast-path that, on
replay, reproduced the IDENTICAL committed model in **1 round-trip — 20x fewer**.

**Settles:** distillation produces a real, materially-faster runbook (skips the
per-cell reasoning), meeting the finding-5 acceptance criterion ("distilled
runbook materially faster than cold, or it isn't written") with a measured 20x
round-trip reduction, not a modeled number.

## 13. Pause/resume continuity around confidential delivery (R22-R24)

Proved the task lane pauses at the confidential step, custody delivers, and the
lane resumes per the directive (discard stale refs, prove a fresh identity basis)
without a stale-ref hazard. Driven on the multistep fixture where the DOM changes
across the confidential step:

- Pre-delivery: lane captures the password field ref (visible/operable).
- After delivery + advance: the SAME ref is no longer visible/operable (reusing it
  would type into the now-hidden previous screen) — the hazard is real.
- Obeying the resume directive (discard the stale ref, re-observe origin + step)
  lands correctly on the next step (`otp`) and progresses.

**Sub-finding (matters for U3/lane impl):** `DOM.resolveNode` succeeding is a
FALSE "ref still valid" signal for SPA logins that HIDE screens (display:none)
rather than remove them — the old node lingers and resolves. Staleness must be
checked by visibility/operability (offsetParent + box), not mere resolvability.
The resume directive's "discard stale refs + re-observe" is exactly the right
posture; a lane that reuses a resolvable-but-hidden ref would silently operate the
wrong screen.

## Harness bugs found while proving lane neutrality (2026-07-31)

Two issues surfaced trying to run `operate`/`task` through the harness:

1. **Discovery is http(s)-only (working as designed).** `targets list` returned
   0 candidates for `file://` scratch fixtures: `parseUrlSafe`
   (`browser-use-core.ts:175`) rejects non-http(s), and the discovery filter
   (`browser-use-discovery.ts:310-314`) drops the page (R32). Serving fixtures
   over `http://localhost` (a Bun static server) fixes it — discovery + select
   then succeed through the harness. **Spike lesson: use a served http fixture,
   not file://, when exercising the harness discovery path.**

2. **REAL DEFECT — `operate` cannot resolve an agent-browser target.**
   `operate snapshot` on the agent-browser lane returns
   `browser_operation_target_missing` even after a successful `targets select`.
   Root cause: `operationTargetEntries` -> `parseAdapterPageId`
   (`browser-use-operations.ts:549-566`) requires an INTEGER page id, but
   agent-browser discovery reports string tab ids (`id: tab.tabId` =
   `"t1"`/`"t2"`, `browser-use-discovery.ts:867`). `Number("t1")` is `NaN` ->
   `pageId = undefined` -> the resolved target is rejected at
   `browser-use-operations.ts:471` ("no longer carries an adapter page handle").
   Proven: `parseAdapterPageId("t1") === undefined`, `("0") === 0`. This blocks
   ALL harness `operate` on the agent-browser lane. Fix needs a design call
   (accept string page ids, or map `t1` -> CDP target id at discovery); NOT yet
   fixed (touches shipped source). Lane-neutrality of the CUSTODY seam is
   unaffected — it attaches by CDP target id, not adapter page id.

## Still unproven (operator-gated / unbuilt)

- **Live FastTrack/Oncore login with a real secret into the REAL portal** —
  operator-gated (KTD9/R13); never agent-driven while U1 is unbuilt (would require
  agent-held plaintext or the not-yet-built supervisor). The supervisor binary is
  NOT currently built at
  `runtime/browser-use-environment-auth/.build/release/browser-use-op-supervisor`;
  the spike used a bash `op read | child` wrapper as a stand-in for it.
