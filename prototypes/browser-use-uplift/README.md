# PROTOTYPE — dual-mode browser-use uplift, full live flow (throwaway)

**Question:** Does the dual-mode `browser-use` flow work end-to-end against a
real portal? Specifically: drive on cheap ephemeral `@refs` in agent-browser
mode, then at the *passover* lazily resolve **only the acted-on refs** to
durable selectors, and emit the handoff list `build-scratch` would consume.

This is NOT a pure-logic TUI — the thing being proven IS the real agent-browser
interaction, so the artifact is a runnable script that drives a live browser and
surfaces state at each step. (Per /prototype: when the question is "does this
real flow work," the prototype exercises it for real.)

## ⭐ Headline proof: fully-automated remote-debugging enable (no human)

`auto-enable-remote-debugging.sh` — PROVEN live, cold→enabled, repeatable:
peekaboo clicks the chrome://inspect "Allow remote debugging" checkbox →
"Server running at 127.0.0.1:9222" → port LISTENING. Zero human.

The battle was COORDINATES, not capability. Fix: **deterministically position
the Chrome window first** (`osascript set bounds {0,30,1200,905}`), then the
checkbox is at a fixed global offset (210,186). No separate Allow dialog — the
checkbox click IS the permission grant. This unblocks fully-automated pre-flight.

## Run

A browser must be reachable on a CDP port first (agent-browser auto-launches its
own Chrome for Testing if none is up). Then:

```
bash prototypes/browser-use-uplift/live-flow.sh <PORT> <URL>
# e.g. bash prototypes/browser-use-uplift/live-flow.sh 9223 https://iteraterecruitment.oncoreservices.com
```

Defaults to a neutral pre-auth login page if no URL given. Uses an ephemeral
session (browser-session-safety: `--session`, `connect`, `--headed`, never the
default session; read-only on real auth state).

## What it exercises (the uplifted flow)

1. **connect** — attach to existing Chrome on the port (the unchanged contract)
2. **drive on cheap refs** — `snapshot -i`, act on `@eN` (the live run)
3. **track acted-on refs** — the script remembers which refs it touched (stands
   in for what browser-use would track during a session)
4. **PASSOVER (lazy resolve)** — resolve ONLY the acted-on refs to durable
   selectors via `get attr id/name`, exactly when the memory skill would ask
   "what did you act on?"
5. **emit handoff list** — print the `{action, durable-selector, value-shape}`
   payload `build-scratch` consumes (values shape-only — Gate 1)

## Throwaway

Delete after it answers the question. The validated flow gets folded into the
real `browser-use` SKILL.md prose + the `browser-domain-memory` passover, not
kept as code.

## Verdict

**The uplifted flow works end-to-end against a real ASP.NET portal.** Ran live;
the full chain executed:

1. ✅ agent-browser attached + landed on the real login page
2. ✅ drove on cheap `@refs` (`@e7 @e8 @e10`) with no capture ceremony
3. ✅ tracked acted-on refs through the session
4. ✅ **PASSOVER resolved ONLY the acted-on refs** to durable selectors:
   `#MainContent_LoginControl_UserName`, `#…_Password`, `#…_LoginButton`
5. ✅ emitted a clean `{action, selector, value-shape}` handoff list with
   **shape-only values** (`redacted:field`) — exactly what `build-scratch` consumes

So the two prototypes chain: this one's output IS the
`prototypes/build-scratch-handoff/` input. Full pipeline proven:
**live drive → lazy-passover selector capture → handoff → gated Recorder JSON.**

### Findings for the brainstorm / plan

1. **Lazy-passover capture is real and clean.** Only the 3 acted-on elements got
   resolved — not the whole page. The "memory skill asks what you acted on"
   model produces exactly the right-sized handoff with no noise. Confirmed.
2. **Refs go stale after `fill` — re-snapshot before resolving.** The script had
   to re-`snapshot -i` at passover before `get attr`, because fills/page changes
   invalidate refs. **Plan implication:** browser-use must either resolve
   selectors at act-time, OR keep a stable handle (not the raw `@eN`) to
   re-resolve at passover. Raw-ref-at-end-of-long-session is NOT safe; the ref
   numbering drifts. This is the single load-bearing implementation detail.
3. **`connect <port>` failed but agent-browser auto-launched its own Chrome.**
   The explicit `connect 9223` errored (nothing there), yet the flow still ran
   on an auto-launched Chrome for Testing — i.e. it did NOT attach to the user's
   real warm Chrome. **Plan implication:** the "attach to existing real Chrome"
   contract needs an explicit, *verified* connect (fail loudly if the real
   Chrome isn't reachable) — silent auto-launch into a fresh Chrome defeats the
   warm-session requirement. This is exactly the warm-session-fidelity question
   the engine ADR must pin: who launches the real-profile debug Chrome, and
   browser-use must refuse to proceed on a non-warm fallback for login flows.
4. **Selector resolution held on real ASP.NET** (consistent with the earlier
   ASP.NET + Angular probes). `get attr id` is the happy path; `[name="..."]`
   the documented fallback.
