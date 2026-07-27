---
status: accepted
date: 2026-05-31
---

# Connect to warm Chrome via a dedicated debug profile, not the default profile or the inspect toggle

`browser-domain-memory`'s replay loop needs a warm, logged-in Chrome that agent-browser (or
chrome-devtools-mcp) can drive over CDP. We connect by launching the **real Google Chrome binary**
with classic `--remote-debugging-port` against a **dedicated persistent `--user-data-dir`** (e.g.
`~/.agent-warm-profile`) — log into portals once, they survive. This was proven cold-start; see
`skills/browser-use/docs/research/2026-05-30-browser-use-warm-chrome-findings.md` and
`skills/browser-use/references/warm-chrome.md`.

## Considered options

- **Attach to the user's everyday default Chrome profile.** Rejected — **not possible.** Chrome 136+
  silently ignores `--remote-debugging-port` on the default user-data-dir (security hardening). The
  flag must be paired with a non-default `--user-data-dir`.
- **Chrome M144 `chrome://inspect/#remote-debugging` toggle.** Rejected — **dead end for our tools.**
  The toggle starts a server but writes no discoverable `DevToolsActivePort` and serves no HTTP
  `/json` endpoint (404). Both agent-browser (`--auto-connect`/`connect`) and chrome-devtools-mcp
  (`--browserUrl`/`--autoConnect`) fail to connect to it. Verified live this session.
- **agent-browser `--profile` / auto-launch.** Rejected — copies the profile to a temp dir and
  launches **Chrome for Testing** (a cold profile), defeating warm-session fidelity. Must never be
  the silent fallback.

## Consequences

- The warm Chrome runs a **dedicated profile**, separate from the user's everyday Chrome: log into
  each portal once in it; logins persist. This is the only post-Chrome-136 path to a real warm
  session over CDP.
- One warm Chrome = one cookie jar. Fine for different-domain portals (the actual use case);
  same-domain multi-identity is out of scope.
- Pre-flight must **verify** it attached to the real binary and **fail loudly** if it only got
  Chrome for Testing — a silent cold-profile fallback would re-trigger captcha/device checks on
  login-heavy portals.
- `browser-use` owns the executable pre-flight; Browser Adapters consume that proof rather than
  carrying separate readiness policies.
- If agent-browser later ships working M144-toggle support (tracked upstream), revisit — attaching
  to the user's actual everyday profile would be simpler.

## Amendment 2026-07-28

The permanent product-level Chrome for Testing ban is retired as a future
direction. Chrome for Testing may become an explicit Browser Use browser class
only after it satisfies the same capability and proof boundary as Warm Chrome:
headed mode, a dedicated persistent owner-only profile, numeric-loopback CDP,
verified binary/profile/listener/endpoint consistency, an exact version, and an
explicit upgrade policy.

The current runtime rejection remains in force until that lane is implemented
and passes authentication-continuity plus profile-migration acceptance evidence.
Chrome for Testing remains forbidden as an automatic or silent fallback.

Decision detail:
`docs/decisions/2026-07-28-001-browser-use-chrome-for-testing-lane-decision-log.md`.
