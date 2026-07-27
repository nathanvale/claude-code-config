# Browser Connect

Browser Adapter attachment runtime: prove Agent Chrome, inject the verified
endpoint into an adapter's declared route, exec the adapter. Success hands a
Verified Handoff Envelope to a consumer; adapters never find Chrome
themselves.

Plan: `docs/plans/2026-07-14-001-feat-browser-connect-plan.md`.
Environment proof owner: `runtime/warm-chrome` (`@side-quest/warm-chrome`).

## Language

**Agent Chrome**:
The dedicated automation Chrome with an explicit CDP endpoint, implemented by
`runtime/warm-chrome`. Warm Chrome is Agent Chrome; the two names refer to
the same browser in both directions — a doc that says "Warm Chrome" means
Agent Chrome, and Agent Chrome is provided by the Warm Chrome runtime.
_Avoid_: default browser, whatever is on `:9222`, headless fallback
_Developer example_: "Attach the adapter to Agent Chrome using the endpoint
from the warm-chrome ok envelope."
_Avoid example_: "Point the adapter at `127.0.0.1:9222` — Chrome is usually
there."

**Human Chrome**:
Nathan's everyday personal Chrome. Never an attachment target; adapters that
guess endpoints risk landing here.
_Avoid_: spare Chrome, fallback profile
_Developer example_: "The proof gate exists so an adapter can never attach to
Human Chrome by accident."
_Avoid example_: "If Agent Chrome is down, reuse the open Chrome window."

**Browser Adapter**:
A tool that attaches to a proven browser environment via a declared route
(`@playwright/mcp`, `chrome-devtools-mcp`, Playwright, Puppeteer, and peers).
An adapter is never trusted to find Chrome itself; browser-connect injects
the verified endpoint into the adapter's declared route. Three definitions are
registered: `chrome-devtools-mcp`, `agent-browser`, and `playwright-cdp` (the
public Playwright CLI lane).
_Avoid_: browser client that self-discovers, adapter with a hardcoded port
_Developer example_: "Register the adapter with its declared endpoint route;
browser-connect fills it from the proof."
_Avoid example_: "The adapter defaults to `:9222`, so no route is needed."

**Playwright CLI lane** (`playwright-cdp`):
The Browser Adapter that attaches the official `@playwright/cli` to Agent
Chrome over the explicit CDP endpoint using a named session, then detaches
without closing the browser. Its probe pins the exact `attach`/`detach`
`--help` lines so any upstream CLI drift fails closed before an implicit
browser launch — connection robustness by diagnosis, never by blind retry. It
never runs `open`, a browser installer, or a channel-name attachment that could
discover or launch another browser. The adapter id is `playwright-cdp`; the
public lane name is "Playwright CLI".
_Avoid_: `playwright-mcp`, "the Playwright adapter launches Chromium"
_Developer example_: "Route the ARIA-assertion task to the Playwright CLI
lane; browser-connect injects the verified endpoint into `attach --cdp=<http>
--session=<name>`."
_Avoid example_: "Let playwright-cli pick a browser channel and connect
itself."

**Verified Handoff Envelope**:
The success-direction result: a proven connection handed to a consumer. It
carries the verified endpoint evidence from the environment proof plus the
attachment outcome — evidence a consumer can act on, not permission to guess.
It is the success-direction mirror of browser-use's failure-direction
**Browser Entry Handoff** (a request back to a browser owner when the
environment is not ready): the envelope hands a *proven* connection forward,
the Browser Entry Handoff hands an *unready* state back. Both names live; do
not conflate them.
_Avoid_: log line, best-effort status, implicit success, Browser Entry Handoff
_Developer example_: "The consumer takes the endpoint from the Verified
Handoff Envelope verbatim."
_Avoid example_: "Exit 0 means connected; the consumer can derive the
endpoint from convention."

**Repair Path**:
The complete recovery contract an error station ships with: one stable
action ID, the typed repair context that selects it, one continuation
posture (automatic `next_action_id` or operator choices with constraints),
and one public versioned `REPAIR.md#v1-<action_id>` anchor. All four parts
or the station cannot ship; a failure missing any of them is a dead end,
not a product surface.
_Avoid_: prose hint, dead-end inspect affordance, error message with a bare
URL
_Developer example_: "The foreign-listener station's repair path is
`use_suggested_port`: typed port evidence in, one hop-1 rerun out, anchored
at `v1-use_suggested_port`."
_Avoid example_: "Return `inspect_diagnostics` with a helpful message; the
caller can work out the port from the text."
