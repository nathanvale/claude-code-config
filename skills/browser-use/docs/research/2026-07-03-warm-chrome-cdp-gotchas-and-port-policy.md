---
date: 2026-07-03
topic: Warm Chrome Runtime Package CDP attach gotchas and port policy
type: research-findings
status: captured
related:
  - ../../../docs/adr/0006-warm-chrome-via-dedicated-debug-profile.md
  - ../../../docs/adr/0009-browser-use-fixed-cdp-convention-and-runtime-proof.md
  - ../PRODUCT.md
  - ../PRODUCT-BASELINE.md
---

# Warm Chrome CDP Gotchas And Port Policy

Research capture for the Warm Chrome Runtime Package boundary inside `browser-use`.

## Prompt

Nathan wanted the first product layer locked before returning to the larger
`browser-use` facade/router vision:

- `browser-use` remains the product.
- Warm Chrome becomes an independently hardened runtime package boundary.
- Warm Chrome means a real warm Chrome over CDP, following the `9222` convention.
- Research the gotchas across Chrome/CDP, Playwright, Puppeteer, agent-browser,
  and Chrome DevTools MCP.

## Recommended Port Policy

Use `9222` as the Warm Chrome convention and default.

If `9222` is unavailable, the runtime should suggest a different explicit port
only as a repair option. It should not silently allocate, launch, persist, or
rebind Warm Chrome onto a different port.

Recommended shape:

1. Probe `9222`.
2. If `9222` verifies as Warm Chrome, use it.
3. If `9222` is free, launch on `9222`.
4. If `9222` is occupied by a non-Warm-Chrome listener, fail loud.
5. Include an informational `suggested_explicit_port`, such as the first free
   loopback candidate found by a runtime scan.
6. Require the operator/agent to rerun with `--port <suggested>` or
   `--endpoint http://127.0.0.1:<suggested>`.
7. Treat that port as a current-run input until proof passes.
8. Make adapters consume the verified endpoint from proof output, not the
   convention.

Do not make the suggestion an allocator. A suggestion is a repair hint. The
verified endpoint remains the authority.

## Why This Is The Best Split

The core failure mode is not "port busy." The core failure mode is false
confidence: tools see a port, a profile path, a websocket, or a tab list and
mistake that for a usable warm browser.

Port suggestions are useful because they reduce operator friction when `9222` is
occupied. Silent allocation is dangerous because it recreates the binding problem
ADR 0009 avoided: agents and adapters later need to discover which non-standard
port became warm.

This split keeps both truths:

- `9222` stays the shared convention.
- A non-standard port remains possible when the machine forces it.
- The runtime never treats the port number as identity.
- Proof output remains the only browser-entry authority.

## Public Gotchas

### Chrome/CDP

- Chrome 136+ ignores or blocks `--remote-debugging-port` against the default
  user data directory. Use a non-default `--user-data-dir`.
- CDP has no authentication layer suitable for broad network exposure. Keep the
  endpoint loopback.
- `/json/version` exposes the browser-level `webSocketDebuggerUrl`; page-level
  websocket targets are not equivalent.
- `DevToolsActivePort` is useful hint material, especially when Chrome chooses a
  port, but it is not lifecycle authority.
- DevTools/CDP protocol surfaces change over time. Tip-of-tree CDP does not
  promise stable backwards compatibility.

### Playwright

- `connectOverCDP` attaches Playwright to an existing Chromium browser over CDP.
- Playwright exposes the existing default browser context after attach.
- Playwright CDP attach is lower fidelity than Playwright's own protocol path.
- CDP attach can fail on browser/context management operations that native
  Playwright launch paths support.
- Recent Playwright docs include `noDefaults`, which matters when attaching to a
  stateful user browser because default overrides can disturb the existing
  context.

### Puppeteer

- Puppeteer can attach to an existing browser through `puppeteer.connect()`.
- The browser websocket usually comes from `/json/version`.
- Users commonly want this path to preserve credentials and avoid repeated
  login.
- `browser.disconnect()` and browser shutdown are different lifecycle actions;
  runtime docs should avoid teaching agents to close the user's warm browser by
  accident.
- The `userDataDir` story is easy to misunderstand: launching with a profile,
  copying a profile, and attaching to an already-running profile have different
  trust consequences.

### agent-browser

- Public issues show `--auto-connect` failures after Chrome M136+ default-profile
  restrictions.
- Public issues also show Chrome M144+ remote-debugging discovery changes where
  HTTP discovery can be absent and direct websocket construction may be needed.
- The product is agent-native and strong on discovery, but auto-connect cannot
  replace a facade-owned Warm Chrome proof.
- Profile flags can produce cold Chrome-for-Testing behavior or daemon reuse
  surprises. That is fatal for login-heavy workflows if it is silent.

### Chrome DevTools MCP

- Official docs recommend launching Chrome with `--remote-debugging-port=9222`
  and a custom `--user-data-dir`.
- The README warns that the debugging port lets local applications control the
  browser.
- Issues show path/config mistakes around `DevToolsActivePort` can break
  connection even when Chrome is otherwise available.
- MCP adapter config can drift from Warm Chrome proof; adapter proof must compare
  its binding with the verified endpoint.

## Product Implication

Warm Chrome Runtime Package is not a launcher.

It is the browser-entry proof owner:

- Prove real Google Chrome.
- Prove dedicated persistent non-default profile.
- Prove loopback CDP endpoint.
- Prove browser-level websocket.
- Prove listener process and requested port match.
- Prove profile belongs to the listener.
- Reject Chrome for Testing and cold-profile fallback.
- Reject non-loopback endpoints.
- Emit repair paths with stable action ids.
- Emit `no_adapter_fallback` after browser-entry failure.

The package promise:

> Given a desired browser entry, prove the agent is attached to the correct warm
> Chrome, or fail with a repair path before any adapter acts.

## Decision Pressure

The older "fail loud, no allocator range" decision still looks directionally
right, but it can be softened without undoing the principle:

- Keep: no silent allocation.
- Keep: no durable binding state.
- Keep: `9222` as convention.
- Add: a runtime-computed suggested explicit port when `9222` is occupied by a
  non-Warm-Chrome listener.

That would improve ergonomics while preserving the proof-first architecture.

## Sources

- Chrome official: `--remote-debugging-port` profile restriction, published
  2025-03-17:
  <https://developer.chrome.com/blog/remote-debugging-port>
- Chrome DevTools Protocol docs: `/json/version`, browser websocket target,
  `DevToolsActivePort`, target lifecycle:
  <https://chromedevtools.github.io/devtools-protocol/>
- Playwright BrowserType docs: `connectOverCDP`, default context, endpoint
  shapes, `noDefaults`:
  <https://playwright.dev/docs/api/class-browsertype>
- Puppeteer docs: `puppeteer.connect()`, browser websocket endpoint:
  <https://pptr.dev/api/puppeteer.puppeteer.connect>
- Chrome DevTools MCP README: remote debugging setup and security warning:
  <https://github.com/ChromeDevTools/chrome-devtools-mcp>
- agent-browser issue #1321: Chrome M136+ default profile and
  `DevToolsActivePort` failure:
  <https://github.com/vercel-labs/agent-browser/issues/1321>
- agent-browser issue #516: Chrome M144+ auto-connect discovery failure:
  <https://github.com/vercel-labs/agent-browser/issues/516>
- Chrome DevTools MCP issue #818: userdata dir path and missing
  `DevToolsActivePort`:
  <https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/818>
- Playwright issue #15370: CDP attach context-management error:
  <https://github.com/microsoft/playwright/issues/15370>
- Puppeteer issue #3543: current Chrome credentials / persistent browser ask:
  <https://github.com/puppeteer/puppeteer/issues/3543>
- Local WOTS run, 2026-07-03:
  `Chrome CDP remote debugging Playwright Puppeteer agent-browser user data dir gotchas`
- Local ADR 0006:
  ../../../docs/adr/0006-warm-chrome-via-dedicated-debug-profile.md
- Local ADR 0009:
  ../../../docs/adr/0009-browser-use-fixed-cdp-convention-and-runtime-proof.md

## Next Useful Work

- Add `suggested_explicit_port` to Warm Chrome failure diagnostics for occupied
  `9222`.
- Keep `suggested_explicit_port` informational until a caller reruns with
  `--port` or `--endpoint`.
- Add tests proving no spawn occurs when `9222` is occupied by non-Warm-Chrome.
- Add tests proving a suggested port never becomes authority without a successful
  Warm Chrome proof.
- Consider an ADR update only if implementation changes the current no-allocation
  runtime contract.

## Cross-Tool CDP-Attach Sweep (2026-07-03, addendum)

A second sweep (Firecrawl) covered the tools the first pass did not: Playwright
CLI + `connectOverCDP`, Cypress, the first-party Chrome DevTools CLI,
recent `chrome-devtools-mcp` issues, and un-studied AI browser agents
(browser-use python lib, Stagehand, Skyvern, Nova Act, Selenium/BiDi,
`chrome-remote-interface`). It confirmed the original gotchas and surfaced
net-new proof obligations. These are folded into the implementation plan
`docs/plans/2026-07-03-001-feat-warm-chrome-runtime-package-plan.md` as
requirements R6a–R6c, R7a, R17 and reason-detail vocabulary.

### Correction to the original capture

- **No distinct Chrome M144 `connectOverCDP` behavior change is documented.**
  Only Chrome 136 is a Chrome/Playwright-level change (default-profile block on
  `--remote-debugging-port`/`--remote-debugging-pipe`). The M144+ item is the
  *default-profile HTTP-discovery hardening* below, evidenced by
  `chrome-devtools-mcp` issues, and the agent-browser auto-connect breakage was
  agent-browser-specific. Prior "M144 discovery changes" wording overreached.

### Net-new proof obligations

- **Identity over liveness.** A listener answering `9222` is not proof of *our*
  warm Chrome — Skyvern documents silently *adopting* an existing instance on an
  occupied port; other CDP clients do the same. Prove process identity
  (`findListener` pid cross-checked against the `/json/version` pid), not just
  that something answers. This is the sharpest confirmation of the false-
  confidence core.
- **A parseable `/json/version` does not prove an attachable browser.** Plain
  `launch()` targets expose a context with zero attachable pages (Playwright
  #11442); Cypress `--remote-debugging-pipe` puts CDP over a file descriptor so
  a process can carry `--remote-debugging-port` in argv with no TCP listener;
  unreachable attaches hang with no timeout (`chrome-devtools-mcp` #590). The
  proof requires a live HTTP round-trip under a bounded timeout plus a trivial
  CDP round-trip (`Browser.getVersion`); a hang or pipe-only argv is
  `endpoint_unreachable`, never a pass.
- **Headless-new is endpoint-indistinguishable from headed** since Chrome 112 —
  identical `/json/version`, ws shape, and tab list. The only reliable CDP tell
  is `HeadlessChrome`/`headless` in the `Browser.getVersion` User-Agent
  (SeleniumBase #3162). Reject rule: reason `headless_not_headed`.
- **On the hardened default profile, a `/json/version` that answers means a
  foreign instance** (Chrome 144/147/150; `chrome-devtools-mcp` #914, #1830,
  #2283) — the default-profile M144 permission-based server has no HTTP
  endpoint, so a positive HTTP discovery there is a different Chrome. Also: the
  `DevToolsActivePort` endpoint id can disagree with the `/json/version` ws id;
  never mix file-derived and HTTP-derived endpoints. Reject rules:
  `json_answers_on_default_profile`, `endpoint_id_mismatch`.
- **CDP responses are untrusted input.** A rogue listener can return a crafted
  `/json/version` that passes literal field checks; cross-validate its process
  identity against `findListener` before accepting.
- **Wrong-browser breadth.** A CDP endpoint may be Electron (Slack, VS Code),
  Chromium, Chrome for Testing, or a cloud browser — all answer `/json/version`
  (Nova Act, Playwright CLI). Detect Chrome-for-Testing by the listener's
  **binary path**, not the CDP banner (CfT's `Browser` string is
  indistinguishable from stock Chrome). Reject rules: `chromium`,
  `electron_or_other`, `chrome_for_testing`.
- **Wrong-context trap.** The same warm Chrome shows a logged-in dashboard on the
  default context and a login page on a fresh/isolated context (browser-use
  python lib, Stagehand). Assert the persistent-profile default context. Reject
  rule: `isolated_context`.
- **CDP error ≠ dead browser.** `No inspectable targets` / HTTP 400 /
  `ClosedChannelException` occur against a healthy browser under multi-client
  contention (`chrome-remote-interface` #402, Selenium #13500). Re-probe
  `/json/version` before a browser-down verdict; classify a target missing its
  `webSocketDebuggerUrl` as `cdp_contention`.
- **Numeric loopback, not the `localhost` alias.** A mangled `/etc/hosts` or VPN
  can make `ECONNREFUSED 127.0.0.1` a false negative or bind the wrong interface
  (Cypress). Reject rule: `localhost_alias`.
- **`--profile-directory` remap on 136+.** `--profile-directory=Profile N` no
  longer selects the real profile; it maps into the custom `--user-data-dir`.
  Assert the resolved profile path lives *under* the dedicated dir. Reject rule:
  `profile_dir_remap`.
- **Bounded suggested-port scan.** Scan only an unprivileged window near `9222`
  (e.g. `9223`–`9299`), never below `1024`; omit the field when the window
  exhausts.

### Adapter-drift amplifier (Now-scope mitigation, durable fix deferred)

- Both new first-party attach CLIs default their zero-config path to the
  *default* profile via the Chrome M144 `chrome://inspect` toggle — Playwright
  `attach --cdp=chrome` (`resolveChannelEndpoint` reads the channel's default
  user-data-dir) and Google `chrome-devtools --autoConnect`. This is the
  opposite of the dedicated-profile posture, so a consumer trusting the `9222`
  convention over the verified endpoint attaches to the wrong Chrome. The
  Now-scope mitigation is that the ok envelope's `use_verified_endpoint` carries
  the actual endpoint (plan R8); the durable fix is the deferred Browser Adapter
  Proof, which must forbid adapters from defaulting to the convention.
- The first-party `chrome-devtools` CLI defaults to **headless + isolated temp
  profile** unless `--userDataDir` is passed — "warming" Chrome with it produces
  exactly the wrong browser. `--browserUrl` attach silently falls back to
  launching a throwaway headless browser on failure (`chrome-devtools-mcp`
  #140/#190) — "connected" is not "connected to the warm one."

### Protocol moving-target (recorded watch item)

- Selenium officially states CDP support is transitional pending WebDriver BiDi;
  CDP domains are per-Chrome-version and auto-generated, with only the three
  latest Chrome versions supported. Raw CDP on Chrome itself is not announced as
  deprecated, but the surface is version-scoped and the industry direction is
  BiDi. Plan R17 records the observed build in the ok envelope, fails loud on
  protocol-shape surprises, and carries BiDi migration as a watch item (not
  Now-scope).

### Sources (addendum)

- developer.chrome.com/blog/remote-debugging-port (Chrome 136, 2025-03-17)
- developer.chrome.com/docs/chromium/headless (headless-new, Chrome 112/132)
- developer.chrome.com/docs/devtools/agents/get-started (Chrome DevTools CLI)
- playwright.dev/agent-cli/commands/attach; playwright.dev/docs/api/class-browsertype
- github.com/ChromeDevTools/chrome-devtools-mcp issues #140, #190, #509, #590, #914, #1830, #2283
- github.com/microsoft/playwright issues #11442, #40158
- github.com/cypress-io/cypress issues #14835, #5623
- github.com/cyrus-and/chrome-remote-interface issue #402
- github.com/SeleniumHQ/selenium issue #13500; selenium.dev/documentation/webdriver/bidi/cdp
- github.com/browserbase/stagehand issue #1392; docs.browser-use.com; skyvern.com/docs; SeleniumBase #3162
