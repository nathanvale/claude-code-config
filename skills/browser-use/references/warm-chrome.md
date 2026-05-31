# Warm Chrome connection (the working recipe)

How to get `agent-browser` (or `chrome-devtools-mcp`) driving a real, warm,
logged-in Chrome. Proven 2026-05; full investigation in
`docs/research/2026-05-30-browser-use-warm-chrome-findings.md`.

## The recipe

Launch the REAL Google Chrome binary with classic `--remote-debugging-port` on a
DEDICATED persistent profile. Log into portals once; they survive in the profile.

```bash
PORT=9444
PROFILE="$HOME/.agent-warm-profile"   # persistent; logins survive here

# launch once if not already up
curl -sf -m2 "http://127.0.0.1:$PORT/json/version" >/dev/null || \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check about:blank &

# agent-browser pins cleanly — no permission dialog, no GUID hunt
agent-browser --session "$S" --headed --cdp "$PORT" get cdp-url
agent-browser --session "$S" --headed --cdp "$PORT" tab list        # real tabs
```

`chrome-devtools-mcp` attaches to the same port via
`--browserUrl http://127.0.0.1:$PORT`.

## Why NOT the everyday default profile / the chrome://inspect toggle

Both are verified dead ends:

- **Chrome 136+** ignores `--remote-debugging-port` on the DEFAULT `--user-data-dir`
  (security hardening). A non-default dir is required.
- The **`chrome://inspect` remote-debugging toggle** (Chrome 144+) starts a
  server but writes NO `DevToolsActivePort` and serves NO HTTP `/json` discovery
  (404). The browser GUID is undiscoverable. BOTH `agent-browser`
  (`--auto-connect`/`connect`/`--cdp`) AND `chrome-devtools-mcp`
  (`--browserUrl`/`--autoConnect`) FAIL on it. Upstream gap
  (vercel-labs/agent-browser#516 not fully closed for default-profile launches).
- Never accept agent-browser's silent fallback to **Chrome for Testing** — it's
  a cold profile, defeats warm-session. Always pre-launch the real binary and
  verify `tab list` shows real tabs.

## Cookies

One warm Chrome = one cookie jar. Fine when portals are DIFFERENT domains (no
clash). Same-domain-two-identities would need separate profiles — out of scope.

## Lifecycle

- Idempotent: reuse the Chrome if the port already answers; launch only if not.
- Close: `agent-browser close --all`, or quit the warm Chrome.
- `agent-browser close --all` before re-launching a different browser — the
  daemon is sticky to its first browser.
- Proof-grade runs pass `--cdp "$PORT"` on every command. `connect <port>` alone
  can leave later commands on a sticky Chrome for Testing daemon.
