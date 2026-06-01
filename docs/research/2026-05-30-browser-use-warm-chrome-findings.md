---
date: 2026-05-30
topic: browser-use warm-Chrome connection + dual-mode + capture
type: research-findings
status: proven-in-prototype
current_status: historical; superseded sections are marked inline
related:
  - prototypes/browser-use-uplift/
  - prototypes/build-scratch-handoff/
  - skills/browser-use/SKILL.md
  - docs/brainstorms/2026-05-30-browse-play-record-replay-requirements.md
  - docs/plans/2026-05-30-001-feat-browser-domain-memory-plan.md
---

# Findings: connecting browser-use to a warm real Chrome (+ dual-mode + capture)

Hard-won results from a long prototyping/research session. Everything below is
**proven by a runnable prototype or verified against a primary source**, not
speculation. These feed the re-brainstorm + re-plan of `browser-domain-memory`
and the dual-mode `browser-use` uplift. Nothing here has been promoted into the
lean skill yet — prototypes are throwaway; lessons land as prose later.

## The core problem (and why it was so confusing)

Driving a **warm, logged-in real Chrome** via CDP got hard in 2026. Chrome's
security hardening repeatedly defeated the "obvious" approaches, and each tool
silently fell back to a cold **Chrome for Testing** instead of failing loud.

## Verified facts (primary sources)

- **Chrome 136 blocks `--remote-debugging-port` on the DEFAULT profile.** The
  flag is ignored unless paired with `--user-data-dir` pointing at a
  *non-default* directory (different encryption key = security rationale).
  Source: developer.chrome.com/blog/remote-debugging-port. So "attach a debug
  port to your everyday default profile" is **impossible** on current Chrome.
- **Chrome M144 added a native toggle** at `chrome://inspect/#remote-debugging`
  ("Allow remote debugging for this browser instance"). Flipping it starts a
  CDP server (e.g. `127.0.0.1:9222`) bound to your **real running Chrome**.
  This machine runs Chrome 148 → toggle available.
- **The M144 toggle is NOT classic HTTP CDP.** `/json/version` returns **404 by
  design**; it's permission-gated **CDP-over-WebSocket** with no HTTP discovery.
  This is why `curl /json/version` and `agent-browser --auto-connect` both fail
  against it. Source: agent-browser#516, Playwright#40027.
- **agent-browser `--profile` does NOT use your real Chrome.** It COPIES the
  profile to a temp dir and launches Chrome for Testing with that snapshot.
  Observed live: `user-data-dir=/tmp/...agent-browser-profile-...`,
  `remote-debugging-port=0`, doctor shows "Chrome for Testing". So no
  `--profile`/`--executable-path` combo yields the warm real Chrome.
- **agent-browser runs a sticky daemon.** First launch sets the browser; later
  calls show `--profile ignored: daemon already running` and reuse whatever the
  daemon first started (often a stale Chrome-for-Testing). Must
  `agent-browser close --all` before a different browser can be launched.
- **No new Chrome 144-149 CAPTURE primitive.** DevTools Recorder is still
  human-panel-only (no CDP/extension capture surface). WebMCP (Chrome 149 origin
  trial) is *site-cooperative tool exposure*, not flow capture — watch, don't
  adopt. Keep the agent-browser snapshot→ref→selector capture approach.
- **agent-browser M144-toggle support is in-flight upstream** (issue #516, PRs
  #533/#1119): read `DevToolsActivePort` directly, build the WS URL without HTTP
  probing, raise timeout for the approval dialog. Until it lands, agent-browser
  cannot use the toggle.

## Proven recipes (runnable, in prototypes/browser-use-uplift/)

### Fully-automated remote-debugging enable — NO human ⭐
Historical only. The toggle can start a server, but the resolved section below
rules out this path for current tools.

`auto-enable-remote-debugging.sh`. Proven cold→enabled→repeatable.
The battle was COORDINATES, not capability — peekaboo CAN click the chrome://
web-content checkbox once the window is positioned deterministically:

1. `open -a "Google Chrome" "chrome://inspect/#remote-debugging"`
2. `osascript ... set bounds of front window to {0, 30, 1200, 905}` (DETERMINISTIC
   position on main display — the key fix; don't trust where the window is)
3. `peekaboo click --coords 210,186` (window origin 0,30 + checkbox offset 210,156)
4. verify `lsof -iTCP:9222 -sTCP:LISTEN` → "Server running at 127.0.0.1:9222"

No separate Allow dialog — the checkbox click IS the permission grant.

### chrome-devtools mode warm connect (real Chrome)
Superseded. The resolved section below corrects this: MCP server startup was
misread as Chrome attachment, and the toggle path did not connect.

`chrome-devtools-mcp --browserUrl http://127.0.0.1:9222` → connects to the
toggle-enabled real warm Chrome. Proven ("Chrome DevTools MCP Server connected").
NOTE: the repo's mcporter config defaults to 9223; the toggle server is on 9222 —
the binary with `--browserUrl 9222` is the working invocation.

### agent-browser mode warm connect (dedicated profile)
Needs CLASSIC CDP (toggle won't work). Recipe: launch REAL Chrome with a
dedicated non-default profile + classic debug port:
`"/Applications/Google Chrome.app/.../Google Chrome" --remote-debugging-port=9333 --user-data-dir=<dedicated dir>`
then `agent-browser connect 9333`. Pre-flight must verify it's real Chrome, not CfT.

### Durable selector capture (the recording mechanism)
`snapshot -i` → ephemeral `@eN` refs → resolve to durable selectors via
`get attr @ref id`/`name` (or `eval` CSS-path fallback). Proven unique+stable on
BOTH ASP.NET (`#MainContent_LoginControl_UserName`) and Angular (`#lgUserName`)
portals — the two hardest selector environments. `@refs` go STALE after page
changes; re-snapshot before resolving, OR resolve at act-time.

### Lazy-passover capture model
browser-use drives on cheap refs; at end-of-session `browser-domain-memory`
ASKS "what did you act on?", browser-use resolves ONLY those refs to durable
selectors then. No per-action logging, no noise. Proven: only the 3 acted-on
fields resolved, emitted a clean `{action, selector, value-shape}` handoff list
(shape-only values = Gate 1). That list IS the input to `build-scratch`.

### Pre-flight + state-record
`preflight-dual-mode.sh`. Detects warm Chrome per mode, records a "configured"
state file, and re-runs short-circuit the setup ask. Proven both runs.
State-file LOCATION still undecided (temp dir for now) — a brainstorm/plan call.

## Dual-mode browser-use design (decided this session)
Superseded. Current direction: no fixed default Browser Adapter; `browser-use`
selects adapters by requested outcome and verified capability.

- Default driver: **agent-browser** (durable selector capture, session fleet).
- Auto-swap to **chrome-devtools MCP** only for DevTools-panel-grade work
  agent-browser can't do (Performance insights, deep Network-panel inspection);
  ANNOUNCE the swap to the user. User can pin either mode.
- For attaching to the warm REAL Chrome today: **chrome-devtools mode via the
  M144 toggle + `--browserUrl 9222` is the working path.** agent-browser mode
  uses a dedicated-profile classic-CDP Chrome until upstream toggle support lands.
- The dual-mode skill prose was drafted in `skills/browser-use/SKILL.md` this
  session but should be treated as PROVISIONAL — let the full smoke test drive
  the final wording before considering it settled.

## ⭐ RESOLVED: the working warm-Chrome recipe (2026-05-30, late session)

After deep investigation, the M144 toggle path was ruled OUT and a reliable path
was PROVEN. Corrections to earlier claims in this doc:

**The M144 `chrome://inspect` toggle is a DEAD END for both tools.** It starts a
debug server but:
- writes NO `DevToolsActivePort` file anywhere discoverable,
- serves NO HTTP `/json` discovery (404 on everything),
- requires the browser GUID in the WS URL, which is undiscoverable on a
  default-profile / bare-launched Chrome.
- **BOTH** agent-browser (`--auto-connect`/`connect`/`--cdp`) **AND**
  chrome-devtools-mcp (`--browserUrl`/`--autoConnect`) FAIL on it
  ("Could not find DevToolsActivePort" / "/json/version HTTP Not Found"). This
  is an upstream gap (#516 not fully closed for this case), not fixable from a
  prototype. **Correction:** earlier in this doc I claimed chrome-devtools-mcp
  connected via `--browserUrl 9222` — that was misreading "MCP Server connected"
  (server started) as "connected to Chrome". It did NOT connect.

**THE WORKING RECIPE (proven repeatable, cold→capture):**
`prototypes/browser-use-uplift/warm-connect-WORKING.sh`. Launch the REAL Google
Chrome binary with CLASSIC `--remote-debugging-port` on a DEDICATED
`--user-data-dir` (Chrome-136-safe; real binary so sessions/cookies are real and
persistent — log into portals once, they survive). Classic debug DOES write
`DevToolsActivePort` + serve HTTP discovery → agent-browser `connect <port>`
returns "✓ Done" with NO dialog, NO GUID hunt, NO Chrome-for-Testing fallback.

Proven end-to-end: connect → real oncore tab listed → snapshot → durable
selectors (`#MainContent_LoginControl_UserName` etc.) on the REAL Chrome.

**Consequence for the design:** the "attach to the user's existing everyday
Chrome via the toggle" dream is NOT viable today (upstream gap). The viable warm
path is a **dedicated persistent real-Chrome profile** that the skill launches
once with classic debug. Different from the default profile, but real binary +
persistent logins = warm in every way that matters. The peekaboo toggle-enable
work (`auto-enable-remote-debugging.sh`) still works but feeds a path the tools
can't consume — keep it for reference, don't depend on it.

## Decided: one shared-cookie Chrome (2026-05-30)

**Decision: v1 uses ONE real Chrome, one cookie jar, portals as tabs.** Nathan's
portals are all DIFFERENT domains (oncore, manpower, xero, monash) → different
cookie jars → no clash. So the "one browser, many warm tabs" model works with
zero per-session isolation machinery. The same-domain-different-identity case
(e.g. two logins to one SSO) is **explicitly out of scope** — it's the only case
that would need separate profiles, and it doesn't apply here. This keeps "one
instance" and "no cookie clash" both true without the profile-isolation tradeoff.

Consequence: the strong per-session-isolation model (agent-browser `--profile`
per identity) is NOT pursued — it would fight the one-instance goal for no
benefit given different-domain portals.

## Vision scorecard (what's proven vs gap, 2026-05-30)
Superseded. Do not use this as current status; the resolved section and active
plan replace the toggle-based scorecard.

- ✅ **Real Chrome** — proven for chrome-devtools mode (toggle + `--browserUrl 9222`).
- ⚠️ **Real Chrome for agent-browser mode** — needs upstream toggle support
  (#516) OR a dedicated-profile classic-CDP Chrome until then.
- ❌ **ONE instance for BOTH modes** — NOT yet; the two modes use different
  Chromes today (agent-browser can't share the toggle Chrome until #516).
- ✅ **Tabs not windows** — proven (`tab list`/`tab new`/jump-back).
- ✅ **Multiple different-domain portals, no cookie clash** — holds by the
  decision above (different domains = different cookies).
- ✅ **Close the whole thing** — `agent-browser close --all` / close real Chrome.

Net: ~70% landed; "one instance for both modes" is the main gap, and it closes
when agent-browser ships M144-toggle support (#516).

## Open questions (for re-brainstorm / re-plan)

- State-file + memory-root location (repo-local vs `~/.config/...`).
- Whole-batch-refuse: name first offender only vs list all.
- Whether to keep `build-scratch` as a builder at all, or whether durable
  selectors from agent-browser make a different capture shape better.
- When agent-browser ships M144-toggle support (#516), can BOTH modes share ONE
  warm real Chrome on the toggle? Would collapse the dual-warm-recipe split.

## Smoke test (defined, pieces all proven, not yet chained)
Superseded. The toggle-based smoke shape is historical only; current preflight
uses the dedicated persistent Warm Chrome contract.

Clean machine → cold open → auto-enable toggle → warm connect → both modes →
capture → state record. Every step is individually proven by the prototypes
above; the remaining work is chaining them into one runnable clean-machine smoke.
**Smoke test lives ONLY in the prototype — never promote it to the lean skill.**
