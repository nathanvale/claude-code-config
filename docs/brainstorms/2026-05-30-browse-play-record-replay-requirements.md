---
date: 2026-05-30
updated: 2026-05-31
status: requirements
scope: deep-feature
related:
  - docs/ideation/2026-05-30-browse-play-record-replay-ideation.md
  - docs/research/2026-05-30-browser-use-warm-chrome-findings.md
  - skills/browser-use/SKILL.md
  - skills/browser-use/references/warm-chrome.md
  - CONTEXT.md
  - prototypes/browser-use-uplift/
  - prototypes/build-scratch-handoff/
---

# Requirements: browser-use + browser-domain-memory

## Summary

Give the browser agent durable per-domain memory that turns a chore done once into a
one-click (later auto-scheduled) workflow. `browser-use` drives the user's real warm Chrome;
a net-new `browser-domain-memory` skill captures what a flow learned (real durable selectors,
auth pointers, gotchas), replays it deterministically next time, and self-heals when the page
drifts. Every load-bearing risk in this design has been proven in throwaway prototypes
(`prototypes/browser-use-uplift/`, `prototypes/build-scratch-handoff/`).

**This requirements doc reverses the original "prose-only, no machinery" landing.** That earlier
framing (D1: no builder, no replay engine, no self-healing) was a deliberate refusal made before
the risks were tested. Prototyping this session tested them — capture, cold replay, healing,
memory value, and the unattended-run safety gates all work — so v1 now ships the machinery.

## Users and value

Single user (Nathan), driving login-heavy enterprise portals where the **same flow recurs**:
weekly timesheets (Oncore, FastTrack360), Xero reconciliation, admin/invoicing portals. Today
each run re-discovers the login path, the form quirks, and the traps from scratch.

The value is concrete and measured: a two-run prototype on a real portal showed run 1 (cold) doing
**22 discovery operations** to locate the login fields; run 2 (warm, from memory) did **0** — it
read the stored selectors and went straight through. The payoff isn't "redo a one-off booking" —
it's **stop hand-clicking the chores you repeat 52 times a year.** A weekly timesheet captured once
becomes a button you press (and, once hardened, a job that runs every Friday).

**Honest framing of the speedup (corrected by real measurement).** The win is NOT that finding
selectors is slow — measured, raw `querySelector` is trivial (~8ms; a real cold-vs-warm clock on a
simple login page was only 1.0× faster). The win is **eliminating the agent's look-and-think loop**:
a live cold run snapshots the page + enumerates elements before each step and re-snapshots after
each action (~5.4× browser cost alone), and on top of that pays an LLM reasoning round per step
(snapshot → reason → act → re-snapshot), which is seconds each. Replay does **zero** reasoning
rounds. So the real lever is reasoning-rounds/snapshots eliminated, not selector speed — small on a
trivial page, large on a multi-step portal flow. (An earlier 9× figure was a cost-model simulation,
not a measurement; treat it as illustrative.)

Observable today: `browser-use` drives live end-to-end against real portals (Oncore, FastTrack360);
the warm-Chrome connection, real selector capture, and cold replay are all proven on real sites.
The missing piece was the memory + replay loop — that is what this builds.

## The two skills

**`browser-use`** — live Chrome driver and the only user-facing front door. Owns connection,
inspection, navigation, clicking, filling. Drives freely by default; consults
`browser-domain-memory` on friction/repeat/auth/danger; hands captured flows back at end of
session. Now a dual-mode driver: agent-browser (default) for selector capture + warm-session
work, Chrome DevTools MCP for DevTools-panel work. (Already rewritten this session — see
`skills/browser-use/SKILL.md`.)

**`browser-domain-memory`** (net-new) — durable per-domain browser knowledge + the capture /
replay / heal machinery. Owns Auth Pointers, Browser Runbooks, Browser Gotchas, Scratch Evidence
(real-selector Recorder JSON), and Run Outcomes. Modes: read-before-run (return context / replay a
known flow), and capture-after-run (propose clean durable entries for approval). Never writes a raw
transcript. Never stores a secret value.

Glossary for all knowledge types is canonical in `CONTEXT.md` — not restated here.

## Decisions

### D1 — v1 ships capture + replay machinery (REVERSED from prose-only)

`browser-domain-memory` v1 builds the real loop, not just folders + prose. The original D1 deferred
all machinery until a flow became a "Machine Play Candidate"; prototyping showed the machinery is
buildable now and is what delivers the value, so it ships in v1:

- **Capture** real durable selectors (`agent-browser snapshot → @ref → get attr id`), proven stable
  on ASP.NET and Angular portals.
- **Store** as the dual-output contract (D5).
- **Replay** deterministically, then **self-heal** on drift (D6).
- **Verify** capture and recall so bad/stale memory can't silently poison runs (D7).

The scratch-parsing helper that the original doc deferred is now in scope.

### D2 — Capture discipline ships as a full both-sided list

(Unchanged.) Persist only when it creates future value; never capture ordinary noise. SKILL.md
ships both the **ask-to-capture-when** triggers (chose an auth/account/MFA fork; found a stable
path through a confusing flow; learned field names/order; learned a submit/destructive guard; hit a
future-trap; user said it repeats) AND the **do-not-capture** list (normal navigation, one-off
research, ordinary clicks, scrolls, retries, snapshots, transient selectors, failed guesses unless
the failure is a trap). The negative boundary stops the noise threshold drifting.

### D3 — Capture UX: consult on friction, propose before write, human in the loop

(Largely unchanged.) `browser-use` drives live; reads memory before acting only when consult-gate
triggers fire (D4); at end of session hands a redacted summary to `browser-domain-memory`, which
**proposes** clean entries (Auth Pointer / Runbook / Gotcha / Run Outcome / Scratch Evidence) as a
batch the user approves, edits, or discards. Manual "save what you learned" also works. Nothing
reaches durable memory without consent.

**New (the timesheet flow):** when a captured flow completes and is **verified successful** (D7),
`browser-domain-memory` may offer to **promote it to a saved, named, runnable workflow** — a flow
the user can re-run with one manual trigger. Auto-scheduling (e.g. every Friday) is the hardened
next tier (see Scope).

### D4 — Consult gate lives in prose, friction-triggered

(Unchanged.) `browser-use` does not preflight ordinary browsing. It consults
`browser-domain-memory` on: auth/SSO/MFA/account-or-tenant-picker/1Password; repeat-language
("again", "same as before", "timesheet", "payroll"); stuck/looping; a fork that risks wasting time
or changing account; submit/destructive/financial/admin actions where prior gotchas reduce risk;
explicit save/remember/reuse. Not for ordinary browsing or no-auth one-off inspection. A tiny
SKILL.md section, not a workflow rewrite. The consult gate's value is proven (the 22→0 result).

### D5 — Capture contract: dual output (Recorder JSON + agent run-book)

One rich capture emits **two** artifacts:

- **Strict Chrome DevTools Recorder JSON** — valid (validated against `@puppeteer/replay parse()`),
  for deterministic Puppeteer replay.
- **Agent run-book** — per step: label, an **ordered selector fallback chain** (id → name → aria →
  text), a **wait-for** condition, and a **post-step assert** (what the page must show next).

Both are required. The lesson that forced this: a naive click-log capture broke on replay — it
missed an order-dependent step (a "Next" button only appears after a prior selection), had no waits,
and used a single fragile selector. Capture **must** record order-dependent steps, waits, and
fallbacks or replay breaks.

**When are steps/selectors captured? Hybrid — capture live, tidy at end, commit only if verified.**
Not an either/or:
- **Journal during the run** — append each action as it happens (order, wait-for, the real resolved
  selector). Order + waits are only knowable live; an end-of-run reconstruction from a *set* of
  actions loses them and breaks replay.
- **Tidy at end** — filter the journal: drop fumbles, superseded retries, and no-effect
  scrolls/snapshots; keep the winning path with the *corrected* selector. Cleanliness can't be done
  live (you don't yet know which clicks were fumbles).
- **Commit on verified** — promote to durable memory only if the run completed and verified
  (see D7's commit boundary). Otherwise discard.

### D6 — Replay model: deterministic first, then self-heal on drift

Replay the Recorder JSON deterministically. When a selector drifts, the agent re-drives the
run-book via a proven three-tier ladder: **fallback selector chain → text-disambiguation within a
generic selector → re-find by the step's label/role metadata.** Proven live with every primary
selector deliberately broken; no LLM call needed — the run-book metadata is the judgment.

### D7 — Memory quality gates (so memory can't rot)

Four gates, all prototyped, all v1 (not deferred):

- **Verify-on-capture** — a resolved selector must pass its assert (a "submit" target is actually a
  submit; a "password" field is type=password) before it's stored. Rejects confident-wrong captures
  at the source.
- **Re-verify-on-recall** — before trusting a recalled selector, cheaply confirm it still matches;
  on failure, re-discover and re-capture. Self-correcting.
- **Provenance + confidence** — store *how* each selector was found (by-id high → by-text-fuzzy /
  by-heal low); low-confidence selectors get re-verified harder; heals decay confidence so flaky
  selectors keep getting re-checked.
- **Staleness / invalidation** — a tunable policy scores whole-runbook health from Run Outcome
  history → healthy / degrading (re-verify proactively) / stale (invalidate + force full recapture).
  Flips on consecutive failures, rising heal-rate, mass drift (redesign), or age.
- **Atomic commit boundary** — durable memory is written **only** on verified completion. Capture
  stages into a scratch journal; on confirmed success the journal is promoted by swapping a
  reference (never mutating the live runbook in place). A crash mid-flow, or a failed/ambiguous
  verification, discards the scratch — durable memory is unchanged, and a crashed *overwrite* leaves
  the previous known-good runbook intact. Invariant: durable memory holds either a fully-complete
  verified runbook or the previous good one — **never a partial**. (Real impl: write-to-temp +
  atomic rename; `confirmed` is the only promotion trigger.)

**The four gates compose into one self-maintaining lifecycle** (proven end-to-end as a single arc):
a runbook runs clean (healthy) → one selector drifts and healing recovers it mid-run, but the heal
ticks heal-rate up and confidence decays → staleness flags **degrading** (re-verify proactively) →
a site redesign kills most selectors, healing can't recover, the run fails → staleness marks
**stale**, invalidates the runbook, and triggers a cold **recapture** that rebuilds it with fresh
selectors → healthy again. Healing is per-step and optimistic (keep the run alive); staleness is
whole-runbook and skeptical (catch the rot before catastrophic failure). A run can
**succeed-but-degrade** — that's the early-warning signal. Recapture resets the history scope so the
rebuilt runbook isn't pinned stale by the dead one's failures.

### D8 — Unattended-run safety gates (for the auto-schedule tier)

Three gates, all prototyped, required before any **unattended** run is trusted:

- **Reliable submit** — clicks escalate (native → dispatched pointer sequence → inner target →
  keyboard) and each attempt is checked against an `expectedEffect`. A click that ran but produced
  no effect is a miss → escalate; total failure returns an **honest failure, never a false
  success.** The verified effect is the unit of success, not the click.
- **Live auth pull** — the run resolves a secret from 1Password at run time (via the `one-password`
  skill), fills it, and the secret reaches **no** persisted artifact or log (leak-checked). Memory
  stores only the Auth Pointer + shape placeholders. **This is core, not optional:** the dedicated
  warm-Chrome profile (D9) starts with no logins, so the only way it stays hands-free is the robot
  logging itself in via `op` each run — exactly as a person would. Without it the user logs in
  manually every run, defeating the purpose. (Boundary prototyped with a mocked `op`; real `op`
  wiring promoted to v1 — see Scope.)
- **Success verification** — after the terminal action, `verifyOutcome` returns
  **confirmed / failed / ambiguous** from a success-signal spec (URL pattern, confirmation text,
  success element, form cleared). **Ambiguous is not success** — it routes to a human alert, so an
  unattended run never silently claims the timesheet was filed.

### D9 — Engine dependency: warm real-Chrome recipe (resolved)

The replay loop requires a warm, logged-in Chrome. Resolved this session: launch the **real Chrome
binary** with classic `--remote-debugging-port` on a **dedicated persistent `--user-data-dir`**
(real cookies, logins survive; cold-start proven). Consciously refused, with evidence: Chrome 136+
blocks debug on the default profile, and the M144 `chrome://inspect` toggle exposes no endpoint
either agent-browser or chrome-devtools-mcp can consume. (Full recipe: `references/warm-chrome.md`;
findings: `docs/research/2026-05-30-browser-use-warm-chrome-findings.md`.) An ADR is warranted to
record this durably.

### D10 — Concurrency: serialise per domain (true parallelism deferred)

Runs against the single shared warm Chrome **serialise per domain** in v1. A spike showed
same-domain concurrency on one shared Chrome is unsafe — two runs interleave fills on the one page
and their commits race (lost update). A per-domain lock/queue removes the collision; the atomic
commit boundary (D7) keeps the durable write safe even under contention. True parallelism (a manual
run + the scheduled Friday run at once) needs per-run BrowserContext isolation — blocked today by
the cookie-isolation gap (`vercel-labs/agent-browser#1068`) — or N dedicated Chrome instances; both
are a future spike, not v1.

## Scope boundaries

### In scope (v1)

- `browser-domain-memory` skill: read/replay mode + capture mode, with the capture→replay→heal
  machinery (D1, D5, D6).
- Memory quality gates: verify-on-capture, re-verify-on-recall, provenance-confidence,
  staleness-invalidation (D7).
- Real durable selector capture; dual-output storage (Recorder JSON + agent run-book).
- `browser-use` consult-gate + capture handoff (already drafted in `skills/browser-use/SKILL.md`).
- Run Outcomes tracked per flow (also feed staleness scoring).
- **Promote a verified flow to a saved, named, one-click (manual-trigger) workflow.**
- Gate 1 secret safety: shape-only values in every artifact, including the replayable JSON.
- **Live `op` auth pull** — the warm-Chrome profile (D9) starts empty; the robot logs itself into
  each portal at run time via the `one-password` skill (`op`), fills the secret, leaks nothing.
  Promoted to v1 because the warm profile cannot stay hands-free without it (otherwise the user
  logs in manually every run). The no-leak boundary is prototyped (mocked `op`); v1 wires real `op`.

### Deferred for later (proven, named — not vague)

- **Unattended auto-scheduling** (e.g. run the timesheet every Friday). The machinery is proven
  (D8) but unattended trust needs all three safety gates (reliable-submit, live-auth, success-verify)
  wired live + hardened. Ships after manual one-click is solid. (Note: live `op` auth itself is now
  v1 — it's needed even for the manual one-click run; what's deferred is the *unattended* trigger.)
- **True concurrent / parallel runs** (D10) — v1 serialises per domain; real parallelism (per-run
  BrowserContext isolation or N Chrome instances) is a future spike.
- Cross-machine / cross-user sharing of runbooks — out of scope (user-bound).

### Outside this product's identity (conscious refusals — updated)

- No raw-transcript memory. Durable knowledge is curated; Scratch Evidence is redacted.
- No network-layer capture.
- No predicate-selection schema (pick-row-by-data stays a live `browser-use` task).
- No mid-flow re-auth engineering. Auth is a prefix; a mid-flow auth wall → stop.
- No same-domain multi-identity isolation. One warm Chrome = one cookie jar; fine for Nathan's
  different-domain portals (decided this session). Two identities on one SSO domain is out of scope.
- (Removed from the original refusal list, because prototypes reversed them: a replay engine, a
  capture builder, and self-healing now exist and ship in v1.)

## Success criteria

- A second run on a known domain demonstrably starts from memory (selectors recalled, zero
  rediscovery) — proven in prototype (22→0 ops); v1 reproduces it in the real skill. The measured
  speedup comes from eliminating reasoning rounds/snapshots, not raw selector speed — track
  rounds/snapshots-per-run, not just wall-clock.
- A captured flow replays deterministically on a real portal, and self-heals when a selector drifts.
- Memory is self-maintaining over its lifetime: a runbook that drifts heals what it can, flags
  degrading on rising heal-rate, and on a redesign invalidates + recaptures itself — proven as a
  single healthy→degrading→stale→rebuilt arc (D7).
- Memory stays curated and self-correcting: bad captures are rejected at capture, stale runbooks are
  invalidated, low-confidence selectors get re-verified — verified by the D7 gates holding.
- No secret value ever reaches disk, logs, or any persisted artifact (leak-checked).
- The robot logs itself into a portal via real `op` (no manual login), and the secret leaks nowhere.
- A user can complete a recurring chore once and save it as a one-click workflow that re-runs it.
- `browser-use` still drives ordinary browsing with zero memory ceremony.

## Dependencies and assumptions

- `browser-use` drives live Chrome (proven). Dual-mode driver + warm-Chrome recipe already landed
  in `skills/browser-use/SKILL.md` + `references/warm-chrome.md`.
- `one-password` owns safe `op` access; Auth Pointers reference secrets, never hold values.
  `browser-domain-memory` returns "auth needed" to `browser-use`; the driver decides. No third-skill
  fan-out beyond this.
- Composability: `browser-domain-memory` hands back to `browser-use`; it does not call onward.
- Glossary lives in `CONTEXT.md`.
- **Honest caveats (from prototyping):**
  - Click fidelity ≠ selector healing: some web components (Square's `<market-row>`) don't reliably
    fire post-click transitions from synthetic clicks. Finding the element always works; D8's
    reliable-submit escalation + effect-check is the mitigation. Real capture records the working
    live interaction.
  - A bad capture poisons future runs unless verified — which is why verify-on-capture is a v1
    requirement (D7), not a nice-to-have.

## Open for planning (handed to /ce-plan)

- `browser-domain-memory` on-disk layout; **memory-root location** (prototypes used temp dirs —
  repo-local vs `~/.config/context/` per the Memory OS contract is a plan decision).
- The rich-step capture data shape (the internal model both outputs project from).
- Where `build-scratch` / capture-verify / staleness / provenance logic lives (CLI subcommand vs
  module) and its unit-test surface.
- Exact saved-workflow representation + the one-click trigger surface.
- The ADR recording the warm-Chrome engine decision (D9).
- Source prototypes to lift validated logic from: `prototypes/browser-use-uplift/{warm-connect-WORKING.sh,
  recorder-json, booking-furdo, runbook-dual, self-healing, consult-gate, capture-verify, staleness,
  provenance, reliable-submit, live-auth, success-verify, op-auth, lifecycle, metrics-real,
  metrics-telemetry, journal-tidy, crash-safety, parallel-spike}`, `prototypes/build-scratch-handoff/`.
  (`metrics-real` carries the honest speedup framing; `lifecycle` is the end-to-end self-maintaining
  arc; `op-auth` is the real-`op` shape proof; `journal-tidy` is the hybrid capture-timing answer;
  `crash-safety` is the atomic commit boundary; `parallel-spike` is the future concurrency spike.)
