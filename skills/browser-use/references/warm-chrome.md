# Warm Chrome Contract

Single browser-use invariant. Adapters may vary; this does not.

Drive the real Google Chrome binary over loopback CDP with a dedicated
persistent profile. Never Chrome for Testing. Never a throwaway profile.

Sources:

- Investigation: `docs/research/2026-05-30-browser-use-warm-chrome-findings.md`.
- Executable command contract: `skills/browser-use/scripts/command-contract.ts`.
- Focused tests: `skills/browser-use/scripts/preflight-warm-chrome.test.ts`.

## Contract

- Real Google Chrome binary.
- Classic `--remote-debugging-port`.
- Dedicated persistent `--user-data-dir`.
- Loopback CDP endpoint only (`127.0.0.1` / `localhost`).
- Owner-only profile directory (`0700`).
- Log into portals once; cookies survive in that profile.
- One warm Chrome = one cookie jar.
- Adapter must fail loud on blank/isolated Chrome or Chrome for Testing.

## Current Known Endpoints

Observed 2026-06-01 during read-only evaluation:

- `9444`: real Google Chrome, `~/.agent-warm-profile`, CDP responds.
- `9223`: real Google Chrome, actual profile `~/.agent-prose-replay-profile`.
- `~/.cache/chrome-agent/DevToolsActivePort` may point at `9223`; verify the endpoint, not the path.

Do not relaunch or rewrite working Chrome setup just because paths differ.

## Preflight CLI

Agent-facing readiness check:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json
```

Human health:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh status --port "$PORT" --plain
```

Approved browser-entry repair/launch:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh repair --port "$PORT" --profile "$PROFILE" --plain
skills/browser-use/scripts/preflight-warm-chrome.sh launch --port "$PORT" --profile "$PROFILE" --plain
```

- `check`: read-only. No `chmod`. No `DevToolsActivePort` write.
- `status`: read-only human health projection.
- `repair`: safe owner-owned profile permission + `DevToolsActivePort` repair.
- `launch`: validates persistent profile safety, then starts real Google Chrome only when endpoint is missing.
- stdout: program envelope or plain status.
- stderr: diagnostics only. Do not parse as contract.
- `runtime_actions[].id=needs_browser_entry`: hard stop; prepare browser entry before adapter work.
- Specific recovery actions may include `launch_warm_chrome`, `repair_profile`, `inspect_listener`,
  `inspect_diagnostics`, or `change_input`.
- `error.hint`: next safe recovery move.
- Current runtime: macOS only.

### Continuation contract

One safe next step per run. Read it from the current run, not from static lists.

- Per-run `runtime_actions` outrank static `actionAffordances`. The static contract names possible actions for discovery; the run picks the current set.
- The primary safe next action is the first `runtime_actions` entry whose id is neither `needs_browser_entry` nor `do_not_fallback`. On a browser-entry failure the array leads with the `needs_browser_entry` stop and ends with the `do_not_fallback` guard; the primary action sits between them. Guard actions constrain what must not happen; they do not replace the primary action.
- After a preflight failure, do not switch adapters or fall back to a cold browser. Repair Warm Chrome, then rerun.
- Action membership lives in `scripts/command-contract.ts` and runtime code. This doc states precedence, not the action list.

Auth is not browser entry. The preflight proves Chrome readiness only. A portal login, MFA prompt, or session-expiry wall hit *after* preflight passes is an application step, not a `needs_browser_entry` failure. Do not rerun preflight or switch adapters to escape a login wall; complete the login in the warm profile (cookies persist).

Observability:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json --debug --run-id "$RUN_ID"
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json --quiet
```

- `--run-id` or `BROWSER_USE_RUN_ID`: cross-tool correlation.
- `--debug`: LogTape JSONL breadcrumbs on stderr.
- `--quiet`: suppress diagnostics while preserving stdout result.
- Diagnostics must not include profile paths, CDP websocket paths, Chrome command lines, or secrets.

## Adapter Rules

Preflight owns readiness proof. Adapters consume its result.

### Chrome DevTools MCP / mcporter

Current proven browsing adapter.

- Existing working `mcporter` / `chrome-devtools-mcp` daemon path is valid when Warm Chrome Preflight verifies the endpoint.
- New config should prefer `--browserUrl http://127.0.0.1:$PORT`.
- Existing `--auto-connect --userDataDir` config is acceptable only when its `DevToolsActivePort` resolves to verified Warm Chrome.
- Config repair details: `skills/browser-use/mcporter-config.md`.

### agent-browser

Optional adapter.

- Pass `--cdp "$PORT"` on every command.
- Never rely on `connect <port>` alone.
- Never allow auto-launch / `--profile`; it may create Chrome for Testing.
- Verify `get cdp-url` contains the expected loopback port.

### puppeteer-core

Deterministic replay adapter.

- Connect by `browserURL: http://127.0.0.1:$PORT`.
- Consume preflight proof; do not own Warm Chrome launch or repair policy.

## Why NOT the everyday default profile / the chrome://inspect toggle

Both are verified dead ends:

- **Chrome 136+** ignores `--remote-debugging-port` on the DEFAULT `--user-data-dir`
  (security hardening). A non-default dir is required.
- The **`chrome://inspect` remote-debugging toggle** (Chrome 144+) starts a
  server but writes NO `DevToolsActivePort` and serves NO HTTP `/json` discovery
  (404). The browser GUID is undiscoverable. Both `agent-browser`
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
- Preflight owns readiness proof; adapters consume its result.
- Do not kill, relaunch, or switch adapters while the working setup is healthy.
- If changing adapter or port, ask first.
- Proof-grade runs pin the adapter to the verified loopback endpoint.
