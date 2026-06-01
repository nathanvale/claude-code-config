---
name: browser-use
description: "Route browser work through Warm Chrome Preflight and a real Chrome CDP adapter. No Chrome for Testing."
---

# Browser Use

Use for browser tasks that need a logged-in, profile-bearing Chrome session.

## Contract

- Owner: `browser-use` owns Warm Chrome readiness, repair, launch, and adapter routing.
- Warm Chrome: real Google Chrome binary, dedicated persistent profile, loopback CDP.
- Never Chrome for Testing. Never throwaway profile. Never everyday default profile.
- `browser-domain-memory`, runbooks, and adapters consume preflight proof; they do not own readiness policy.
- Details: `references/warm-chrome.md`.
- MCP config repair: `mcporter-config.md`.

## Preflight First

Before adapter action:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json
```

- Parse stdout envelope. Treat stderr as diagnostics only.
- Success: choose adapter and pin it to verified endpoint.
- Failure with `runtime_actions[].id=needs_browser_entry`: hard stop.
- Do not switch adapters, cold-launch, or fall back to prose after preflight failure.
- Use `repair` or `launch` only when explicitly preparing Warm Chrome entry.
- Contract owner: `skills/browser-use/scripts/command-contract.ts`.

Human health:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh status --port "$PORT" --plain
```

Repair/launch, when browser entry is approved:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh repair --port "$PORT" --profile "$PROFILE" --plain
skills/browser-use/scripts/preflight-warm-chrome.sh launch --port "$PORT" --profile "$PROFILE" --plain
```

Observability:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json --debug --run-id "$RUN_ID"
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json --quiet
```

- `--debug`: LogTape JSONL breadcrumbs on stderr.
- `--quiet`: suppress diagnostics; keep stdout envelope.
- Use `--run-id` or `BROWSER_USE_RUN_ID` for cross-tool correlation.

## Adapter Router

- User-named adapter wins only after preflight passes and the adapter satisfies Warm Chrome.
- Chrome DevTools MCP / `mcporter`: current proven default; use for general work when configured, Network, Performance, and DevTools-grade inspection.
- `agent-browser`: use for named sessions, snapshots/refs, durable selector capture, webm recording, and runbook replay.
- `puppeteer-core`: use for deterministic replay only; connect to verified `browserURL`.
- Explicit fresh/isolated browser request: say it is outside Warm Chrome proof, then use the requested path.
- Never use `chrome-isolated`, Playwright, Puppeteer auto-launch, Codex in-app browser, AppleScript, `osascript`, GUI scripting, or macOS `open` as fallback.

## Chrome DevTools MCP

Use after Warm Chrome Preflight passes. Config repair details live in `mcporter-config.md`.

```bash
mcporter call chrome-devtools.list_pages --args '{}' --output text
mcporter call chrome-devtools.select_page --args '{"pageId":9}' --output text
mcporter call chrome-devtools.navigate_page --args '{"url":"https://example.com"}' --output text
mcporter call chrome-devtools.take_snapshot --args '{}' --output text
mcporter call chrome-devtools.click --args '{"uid":"1_38","includeSnapshot":true}' --output text
mcporter call chrome-devtools.fill --args '{"uid":"1_13","value":"text","includeSnapshot":true}' --output text
mcporter call chrome-devtools.evaluate_script --args '{"function":"() => document.title"}' --output json
```

- Use `take_snapshot` before actions and current `uid` values only.
- Avoid `take_screenshot` unless visual layout matters.
- `list_pages` must show warm profile tabs. Blank/isolated browser means reattach failed.

If `list_pages` fails with `DevToolsActivePort`, confirm the warm Chrome launched on the port (classic `--remote-debugging-port`), then retry once:

```bash
mcporter daemon restart
mcporter call chrome-devtools.list_pages --args '{}' --output text
```

If it still fails, stop and say Chrome DevTools MCP is unavailable. Do not use AppleScript.

Avoid noisy recovery loops. Repeated MCP/browser restarts can trigger reconnect/login prompts and alerts. Try once, then pause and choose a quieter path.

## agent-browser

Use after Warm Chrome Preflight passes.

- Always `--session <name>`; never default session.
- Always `--headed`.
- Always pass `--cdp "$PORT"` on every command.
- Session names come from `~/.config/side-quest/browser-automation/registry.yaml`.
- Never let `agent-browser` auto-launch; it may spawn Chrome for Testing.

```bash
agent-browser --session "$S" --headed --cdp "$PORT" get cdp-url
agent-browser --session "$S" --headed --cdp "$PORT" tab list
agent-browser --session "$S" --headed --cdp "$PORT" tab new <url>
agent-browser --session "$S" --headed --cdp "$PORT" snapshot -i
agent-browser --session "$S" --headed --cdp "$PORT" click @e3
agent-browser --session "$S" --headed --cdp "$PORT" get attr @e7 id
```

Refs (`@e1`...) are reassigned on every snapshot and go stale on any page change. Re-snapshot before the next ref interaction. For durable selectors, resolve a ref via `get attr @ref id`/`name`, or `eval` a CSS path.

`connect <port>` alone can report success while later commands use a sticky Chrome for Testing daemon. Proof-grade runs pass `--cdp "$PORT"` on every command and verify `get cdp-url` contains that port.

## puppeteer-core

Use for deterministic replay against a verified endpoint. Do not launch or repair Chrome here.

```ts
const browser = await puppeteer.connect({
	browserURL: `http://127.0.0.1:${port}`,
});
```

## Live UI Proof

Screenshot regressions, deployed dashboard checks, and rendered-browser bugs require Warm Chrome. `curl`, source inspection, Worker smoke tests, or isolated Playwright are supporting proof only.

## Secret Handling

Never print tokens/passwords from page DOM, network logs, or inputs. For token checks, return shape only: present/absent, length, status code, account/org name.
