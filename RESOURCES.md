# Browser Connection Architecture Resources

## Knowledge

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
  Primary protocol reference. Use for: CDP capabilities, browser WebSocket discovery, HTTP endpoints, and multi-client support.
- [Changes to remote debugging switches](https://developer.chrome.com/blog/remote-debugging-port)
  Chrome security decision from version 136. Use for: why generic CDP requires a non-default user-data directory.
- [Debug an existing browser session with Chrome DevTools MCP](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)
  Chrome's UI-enabled attachment flow from version 144. Use for: `--autoConnect`, explicit enablement, and per-connection consent.
- [Chrome DevTools MCP README](https://github.com/ChromeDevTools/chrome-devtools-mcp)
  Adapter documentation. Use for: choosing automatic connection versus a manual remote-debugging endpoint.
- [Playwright CLI: Attach](https://playwright.dev/agent-cli/commands/attach)
  Official Playwright CLI connection map. Use for: channel attachment through Chrome's remote-debugging UI, explicit CDP endpoints, and extension mode.
- [agent-browser: CDP Mode](https://agent-browser.dev/cdp-mode)
  Official agent-browser connection map. Use for: explicit CDP, automatic Chrome discovery, and direct-WebSocket fallback.
- [Playwright library: `connectOverCDP`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
  Official library API. Use for: attaching Playwright code to an HTTP or WebSocket CDP endpoint and understanding its lower-fidelity boundary.
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
  Official MCP adapter. Use for: `--cdp-endpoint` and Playwright Extension connection modes.
- [Puppeteer: `ConnectOptions`](https://pptr.dev/api/puppeteer.connectoptions)
  Official API. Use for: `browserURL`, `browserWSEndpoint`, and experimental Chrome-channel discovery.
- [Browser Use CLI](https://github.com/browser-use/browser-use/blob/main/browser_use/skill_cli/README.md)
  Official CLI source. Use for: `--connect` automatic discovery and `--cdp-url` explicit attachment.
- [Chrome extension debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
  Official extension API. Use for: tab-scoped CDP attachment without exposing a loopback port.
- [chrome-remote-interface](https://github.com/cyrus-and/chrome-remote-interface)
  Raw Node.js CDP client. Use for: host/port/target attachment and direct protocol access.
- [Selenium Chromium options](https://www.selenium.dev/selenium/docs/api/py/_modules/selenium/webdriver/chromium/options.html)
  Official API source. Use for: attaching ChromeDriver through `debuggerAddress` when compatibility constraints allow it.

## Gaps

- Prove the documented agent-browser and Playwright CLI automatic attachment paths against the installed Chrome 150 build.
- Benchmark multi-agent target contention against the chosen shared Chrome session.
- Verify Puppeteer channel discovery and Browser Use `--connect` against Chrome 150's UI-enabled remote debugging on macOS.
