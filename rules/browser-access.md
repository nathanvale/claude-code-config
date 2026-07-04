## Browser Access

Prevents orphaned browser-adapter pile-ups: adapters that guess `:9222`, attach
with no proof gate, and strand headless fallbacks (the Activity Monitor mess).
Owner of the endpoint contract: `runtime/warm-chrome` (`check --json` ok
envelope, exit `20`, `no_adapter_fallback`, R8 endpoint authority).

- **Gate before connect.** Never point a browser adapter (`@playwright/mcp`,
  `chrome-devtools-mcp`, Playwright, Puppeteer, `claude-in-chrome`) at a CDP
  endpoint before `warm-chrome check --json` returns a verified ok envelope.
  Take the endpoint from that envelope.
- **No convention endpoints.** Never hardcode `http://127.0.0.1:9222`. Use the
  verified endpoint and browser-level websocket URL verbatim from the ok
  envelope; do not derive either from the `9222` convention.
- **Fail closed.** On browser-entry failure (exit `20` / `no_adapter_fallback`),
  stop. Do not fall back to a cold or headless browser, and do not retry
  against the convention port.
- **Never mass-kill by port.** Reap stray adapters by process pattern
  (`pkill -f '@playwright/mcp'`), not by assuming what holds a port. Never
  terminate a listener `warm-chrome` did not verify.

Current authority: `runtime/warm-chrome` (`@side-quest/warm-chrome`) is the gate.
`skills/browser-use/src/preflight-warm-chrome.ts` is a thin delegator to its
`main()`; the browser-use switchover is closed.
