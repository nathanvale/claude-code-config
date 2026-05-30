---
name: browser-use
description: "Drive a warm real-Chrome profile via agent-browser (default) or Chrome DevTools MCP. No AppleScript, no Chrome for Testing."
---

# Browser Use

Use this for browser tasks against a warm, real-Chrome session.

One contract: **drive the real Google Chrome binary with a persistent, logged-in profile — never Chrome for Testing, never a throwaway profile.** Login-heavy sites fail in fresh profiles (captcha, device checks, missing SSO).

Verified constraint (2026-05): you cannot attach to the user's *everyday default* Chrome profile. Chrome 136+ blocks `--remote-debugging-port` on the default profile, and the Chrome `chrome://inspect` remote-debugging toggle exposes no discoverable endpoint that `agent-browser` or `chrome-devtools-mcp` can connect to (no `DevToolsActivePort`, no HTTP `/json`). The working warm path is a **dedicated persistent profile** the skill launches once with classic debug — real binary, real cookies, logins survive. See `references/warm-chrome.md`.

## Driver Mode

**Default: `agent-browser`.** It owns named per-domain sessions, an auth vault, durable selector capture (`get attr`/`eval` resolve refs to real selectors), and webm recording.

**Swap to `chrome-devtools` MCP only when the task needs DevTools-panel-grade work agent-browser can't do:** Performance-panel insight analysis (LCP/latency breakdowns), deep Network-panel request inspection by `reqid`. When you swap for this reason, **tell the user you're switching to chrome-devtools mode and why.**

**User override wins.** If the user names a mode ("use agent-browser", "use MCP/chrome-devtools mode"), use it for the task with no auto-swap.

Never use `chrome-isolated`, Playwright, Puppeteer, the Codex in-app browser, AppleScript, `osascript`, GUI scripting, or macOS `open` for browser control unless the user explicitly asks for an isolated/new browser.

Screenshot/live UI bugs require this warm-Chrome path. `curl`, source inspection, Worker smoke tests, or local Playwright are supporting proof only; do not treat them as equivalent when the user showed a rendered browser problem or the page may depend on login/profile state.

---

## Mode A — agent-browser (default)

Browser-session-safety rules apply: always `--session <name>` (never default), `--headed`. Session names come from the registry at `~/.config/side-quest/browser-automation/registry.yaml`.

Pre-flight: ensure a warm real Chrome is up on the port, then connect. NEVER let agent-browser auto-launch (it spawns Chrome for Testing). Launch the real binary with classic debug + a dedicated persistent profile:

```bash
PORT=9444; PROFILE="$HOME/.agent-warm-profile"
# launch ONCE if not up (log into portals once; they persist in PROFILE)
curl -sf -m2 "http://127.0.0.1:$PORT/json/version" >/dev/null || \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check about:blank &

agent-browser --session "$S" connect "$PORT"   # ✓ Done, no dialog (classic discovery)
agent-browser --session "$S" tab list          # real tabs
agent-browser --session "$S" tab new <url>
agent-browser --session "$S" snapshot -i       # interactive elements + @refs
agent-browser --session "$S" click @e3         # act on a ref (re-snapshot after page change)
agent-browser --session "$S" get attr @e7 id   # resolve ref -> durable selector (capture)
```

Refs (`@e1`...) are reassigned on every snapshot and go stale on any page change — re-snapshot before the next ref interaction. For durable selectors, resolve a ref via `get attr @ref id`/`name`, or `eval` a CSS path. Proven on ASP.NET and Angular portals. See `references/warm-chrome.md` for the full recipe and why the toggle path fails.

## Mode B — chrome-devtools MCP

Config repair details live in `mcporter-config.md`. Use this mode for DevTools-panel work (see Driver Mode) or when the user asks.

```bash
mcporter call chrome-devtools.list_pages --args '{}' --output text
mcporter call chrome-devtools.select_page --args '{"pageId":9}' --output text
mcporter call chrome-devtools.navigate_page --args '{"url":"https://example.com"}' --output text
mcporter call chrome-devtools.take_snapshot --args '{}' --output text
mcporter call chrome-devtools.click --args '{"uid":"1_38","includeSnapshot":true}' --output text
mcporter call chrome-devtools.fill --args '{"uid":"1_13","value":"text","includeSnapshot":true}' --output text
mcporter call chrome-devtools.evaluate_script --args '{"function":"() => document.title"}' --output json
```

Use `take_snapshot` before actions and current `uid` values only. Avoid `take_screenshot` unless visual layout matters.

### Check MCP (Mode B)

```bash
mcporter list chrome-devtools --schema
mcporter call chrome-devtools.list_pages --args '{}' --output text
```

Mode B attaches to the SAME warm Chrome as Mode A (real binary + classic debug + dedicated profile, per the top contract). Point chrome-devtools-mcp at that port (`--browserUrl http://127.0.0.1:$PORT`). Do NOT rely on the `chrome://inspect` toggle / `--autoConnect` — verified non-functional here (no discoverable endpoint). `list_pages` must show the warm profile's real tabs; if it shows a blank/isolated Chrome, stop and say reattach failed.

If `list_pages` fails with `DevToolsActivePort`, confirm the warm Chrome launched on the port (classic `--remote-debugging-port`), then retry once:

```bash
mcporter daemon restart
mcporter call chrome-devtools.list_pages --args '{}' --output text
```

If it still fails, stop and say Chrome DevTools MCP is unavailable. Do not use AppleScript.

Avoid noisy recovery loops. Repeated MCP/browser restarts can trigger reconnect/login prompts and alerts. Try once, then pause and choose a quieter path.

---

## Live UI Proof

For screenshot regressions, deployed dashboard checks, or anything where the rendered browser is the bug, drive the existing logged-in/profile-bearing tab set in whichever mode is active. If browser automation is unavailable, report that as a verification gap instead of substituting isolated browser tooling.

## Secret Handling

Never print tokens/passwords from page DOM, network logs, or inputs. For token checks, return shape only: present/absent, length, status code, account/org name. This rule holds in both driver modes.
