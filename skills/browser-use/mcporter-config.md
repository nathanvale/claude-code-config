# mcporter / Chrome DevTools MCP Config

Use when Chrome DevTools MCP attaches to a blank/isolated browser, cannot see the warm profile's real tabs, or errors around `DevToolsActivePort`.

Canonical contract: `references/warm-chrome.md`.

Do not repair a working setup just because paths look surprising. Verify the CDP endpoint first.

## Expected Setup

Home config usually owns the default:

```bash
mcporter config get chrome-devtools --json
```

Current Browser Adapter Proof verifies the `mcporter` path. If another Chrome DevTools MCP surface is already available in the harness, treat it as future proof work; do not churn config without a new proof path.

If proof reports `configure_adapter_dependency`, expose `mcporter` on PATH or set `BROWSER_USE_MCPORTER_COMMAND_JSON` to an explicit JSON command vector. Package-runner examples are operator choices, not proof fallbacks.

Local runner override examples:

```bash
export BROWSER_USE_MCPORTER_COMMAND_JSON='["bunx","mcporter"]'
export BROWSER_USE_MCPORTER_COMMAND_JSON='["npx","-y","mcporter"]'
export BROWSER_USE_MCPORTER_COMMAND_JSON='["pnpm","dlx","mcporter"]'
```

Preferred new config shape:

```json
{
  "command": "npx",
  "args": [
    "-y",
    "chrome-devtools-mcp",
    "--browserUrl",
    "http://127.0.0.1:9222"
  ]
}
```

Existing `--auto-connect --userDataDir <dir>` config is acceptable only when `<dir>/DevToolsActivePort` resolves to a verified loopback Warm Chrome endpoint. Do not point it at the everyday default Chrome profile.

Observed incident ports belong to provenance, not setup instructions. Current convention is `9222` plus runtime proof.

## Verify

```bash
skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port "$PORT" --json
mcporter call chrome-devtools.list_pages --args '{}' --output text
```

Pass: output lists the warm profile's expected tabs.

Fail: output shows only `about:blank`, a single empty tab, Chrome for Testing, or a page set that does not match the warm profile.

## Fix Config

```bash
mcporter config add chrome-isolated --scope home --command npx --arg -y --arg chrome-devtools-mcp --description "Chrome DevTools MCP - isolated browser for explicit fresh-session tests"
mcporter config add chrome-devtools --scope home --command npx --arg -y --arg chrome-devtools-mcp --arg --browserUrl --arg "http://127.0.0.1:$PORT" --description "Chrome DevTools MCP - warm Chrome CDP"
```

If `mcporter config get chrome-devtools --json` reports a project `source.path`, repair that project override too:

```bash
mcporter config add chrome-devtools --scope project --command npx --arg -y --arg chrome-devtools-mcp --arg --browserUrl --arg "http://127.0.0.1:$PORT" --description "Chrome DevTools MCP - warm Chrome CDP"
```

Then verify again:

```bash
mcporter call chrome-devtools.list_pages --args '{}' --output text
```

## Recovery

If `DevToolsActivePort` or connection startup fails:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh repair --port "$PORT" --profile "$PROFILE" --plain
skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port "$PORT" --json
```

Proof never restarts `mcporter` or edits config. If proof reports stale config, update config outside proof, then rerun. Do not switch to AppleScript, Playwright launch, Puppeteer launch, or `chrome-isolated` unless the user explicitly asks for a fresh browser.

Proof never auto-tries package runners. If `BROWSER_USE_MCPORTER_COMMAND_JSON` is set, it must be a JSON array of non-empty strings.

## Source Notes

mcporter loads config layers from:

- explicit `--config` or `$MCPORTER_CONFIG`
- first existing home config: `~/.mcporter/mcporter.json` or `.jsonc`
- project `config/mcporter.json`

Avoid `/tmp` config files for Chrome. They bypass normal config discovery and make agents copy long commands that are easy to misuse.
