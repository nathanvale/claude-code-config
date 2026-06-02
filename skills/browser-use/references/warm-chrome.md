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

## Endpoint Authority

- Use current preflight `check` / `status` output as endpoint authority.
- Treat observed ports in research docs as provenance, not instructions.
- Do not relaunch or rewrite working Chrome setup just because paths differ.

## Preflight CLI

Agent-facing readiness check:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json
skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port "$PORT" --json
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
- `schema_version: "2"`: `continuation` is runtime authority; guard action ids are gone.
- `continuation.next_action_id`: safe action for this run.
- `runtime_actions`: summaries and side effects for action ids emitted in this run.
- `continuation.constraints`: negative guidance, such as adapter fallback stops.
- `error.hint`: coarse recovery class, not primary recovery.
- Current runtime: macOS only.

### Continuation contract

One safe next step per run. Read it from the current run, not from static lists.

- Per-run `runtime_actions` outrank static `actionAffordances`. The static contract names possible actions for discovery; the run picks the current set.
- Follow `continuation.next_action_id`; use `runtime_actions` only to inspect that action's summary and side effects.
- Obey `continuation.constraints` before choosing adapters.
- Profileless endpoint failures ask for input; `launch_warm_chrome` requires a supplied profile source.
- Browser Entry Handoff constraints stop adapter fallback and cold-browser fallback.
- Browser Adapter Proof runs after Warm Chrome Preflight; its failures also stop adapter fallback and cold-browser fallback.
- `forbidden_action_ids` in a constraint names behaviours to skip, not `runtime_actions` ids. No lookup; obey them directly.
- Read each emitted action's meaning from its `runtime_actions[].summary`, not from this doc.
- Action membership lives in `scripts/command-contract.ts` and runtime code. This doc states precedence, not the action list.

Auth is not browser entry. The preflight proves Chrome readiness only. A portal login, MFA prompt, or session-expiry wall hit *after* preflight passes is an application step, not a Warm Chrome readiness failure. Do not rerun preflight or switch adapters to escape a login wall; complete the login in the warm profile (cookies persist).

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

Warm Chrome Preflight owns browser-entry proof. Browser Adapter Proof owns selected adapter attachment. Adapters consume both results.

### Chrome DevTools MCP / mcporter

Current proven browsing adapter.

- Existing working `mcporter` / `chrome-devtools-mcp` daemon path is valid when Warm Chrome Preflight verifies the endpoint.
- New config should prefer `--browserUrl http://127.0.0.1:$PORT`.
- Existing `--auto-connect --userDataDir` config is acceptable only when its `DevToolsActivePort` resolves to verified Warm Chrome.
- Run Browser Adapter Proof before `list_pages` or page actions.
- Config repair details: `skills/browser-use/mcporter-config.md`.

### agent-browser

Optional adapter.

- Pass `--cdp "$PORT"` on every command.
- Never rely on `connect <port>` alone.
- Never allow auto-launch / `--profile`; it may create Chrome for Testing.
- Verify `get cdp-url` contains the expected loopback port.

### playwright-cdp

Public adapter name for Playwright `connectOverCDP` against verified Warm Chrome.

- Attach to `http://127.0.0.1:$PORT`.
- Do not call Playwright launch APIs.

### puppeteer-core

Deterministic replay detail.

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
