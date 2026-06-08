# Browser Adapter Map: chrome-devtools

Use when Browser Adapter Proof emits a `chrome-devtools` dependency, config, binding, or output recovery action.

## Owners

- Proof runtime: `skills/browser-use/scripts/preflight-browser-adapter.ts`.
- Proof front door: `skills/browser-use/scripts/package.json#bin` (`preflight-browser-adapter`).
- Command contract: `skills/browser-use/scripts/command-contract.ts`.
- Warm Chrome map: `skills/browser-use/references/warm-chrome.md`.

## Rules

- Verify Warm Chrome first.
- Follow the proof continuation.
- Let Browser Adapter Proof classify dependency, config, binding, and output failures.
- Repair selected `chrome-devtools` config only after proof asks for it.
- Read proof diagnostics for `source_label`, `path_hint`, and `observed_port`.
- Repair one cause, rerun proof, then reroute.
- Do not repair a working setup because paths look surprising.
- Do not switch adapters or use cold-browser fallback after a proof constraint blocks fallback.

## Recovery Map

- `browser_entry_handoff`: read `skills/browser-use/references/warm-chrome.md`.
- `use_verified_browser_adapter`: add proof evidence to the Router envelope, reroute, then act.
- `configure_adapter_dependency`: read `Dependency`.
- `update_adapter_config`: read `Config`.
- `inspect_adapter_config`: read `Verify`, then inspect selected adapter output.
- `change_adapter_input`: correct `--adapter`, `--port`, or `--endpoint`; rerun proof.
- `missing_adapter`: use `change_adapter_input`.
- `unknown_adapter`: use `change_adapter_input`.
- `non_loopback_endpoint`: use `change_adapter_input`.
- `invalid_usage`: use `change_adapter_input`.
- `adapter_dependency_missing`: use `configure_adapter_dependency`.
- `adapter_command_override_invalid`: use `configure_adapter_dependency`.
- `adapter_config_missing`: use `update_adapter_config`.
- `adapter_config_stale`: use `update_adapter_config`.
- `adapter_binding_mismatch`: use `update_adapter_config`.
- `adapter_binding_ambiguous`: use `inspect_adapter_config`; stop before action.
- `adapter_output_unparsable`: use `inspect_adapter_config`.
- `adapter_command_failed`: use `inspect_adapter_config`.
- `adapter_config_parse_error`: use `inspect_adapter_config`.
- `adapter_proof_timeout`: use `inspect_adapter_config`.
- `adapter_signal_weak`: warning-only; continue only when proof status is `ok`.
- `adapter_chrome_for_testing_risk`: stop; return to Warm Chrome proof.
- `adapter_auto_launch_risk`: stop; return to Warm Chrome proof.
- `runtime_failure`: stop; inspect diagnostics before repair.

## Operator Choice

- If proof emits `continuation.requires_operator=true`, present its choices.
- Do not pick install, override, or native-config repair for the human.
- Keep exact local repair commands in this file.

## Dependency

- Expose `mcporter` on `PATH`; or set one explicit command vector.
- Treat package runners as operator choices, not automatic fallback.
- Use JSON array command vectors only.
- Unset `BROWSER_USE_MCPORTER_COMMAND_JSON` when the override shape is wrong.
- Keep a working command vector when failure names Chrome DevTools MCP instead of `mcporter`.

```bash
export BROWSER_USE_MCPORTER_COMMAND_JSON='["bunx","mcporter"]'
export BROWSER_USE_MCPORTER_COMMAND_JSON='["npx","-y","mcporter"]'
export BROWSER_USE_MCPORTER_COMMAND_JSON='["pnpm","dlx","mcporter"]'
unset BROWSER_USE_MCPORTER_COMMAND_JSON
```

## Config

- Use `mcporter` config as the proofable `chrome-devtools` surface.
- Prefer `--browserUrl` bound to verified Warm Chrome.
- Use `http://127.0.0.1:$PORT` or `http://localhost:$PORT`.
- Treat other hosts, `https`, and stale ports as binding failures.
- Add home config when proof emits `adapter_config_missing`.
- Overwrite stale or mismatched config with the verified port.

```bash
mcporter config add chrome-devtools --scope home --command npx --arg -y --arg chrome-devtools-mcp --arg --browserUrl --arg "http://127.0.0.1:$PORT" --description "Chrome DevTools MCP - warm Chrome CDP"
```

Use project scope only when proof diagnostics or operator intent name project config:

```bash
mcporter config add chrome-devtools --scope project --command npx --arg -y --arg chrome-devtools-mcp --arg --browserUrl --arg "http://127.0.0.1:$PORT" --description "Chrome DevTools MCP - warm Chrome CDP"
```

- If a native MCP source is stale while `mcporter` is healthy, treat it as warning-only.
- If native MCP is the only named source, add or repair `mcporter` first, then rerun proof.
- Do not hand-edit native JSON or TOML unless proof still blocks after `mcporter` repair and the operator approves.
- Accept `--auto-connect --userDataDir <dir>` only when proof resolves `<dir>/DevToolsActivePort` to verified Warm Chrome.

## Inspect

```bash
mcporter config get chrome-devtools --json
mcporter call chrome-devtools.list_pages --args '{}' --output json
```

- Use when proof emits `inspect_adapter_config`.
- Treat empty page lists as `adapter_signal_weak`; continue when proof status is `ok`.
- Treat non-zero `list_pages` as adapter command failure.
- Treat unparsable output as adapter output failure.
- Treat timeout as incomplete proof, not weak signal.
- Report page URLs by shape only; do not paste auth-bearing URLs.

## Warnings

- Continue when proof status is `ok` and continuation is `use_verified_browser_adapter`.
- Leave non-selected stale, mismatched, or malformed native config alone unless asked.
- Record `adapter_signal_weak`; page action may still create or select a tab later.
- Treat warning `docs_url` as background reading, not active continuation.

## Verify

```bash
cd skills/browser-use/scripts
bun run preflight-browser-adapter check --adapter chrome-devtools --port "$PORT" --json
```

- Pass: proof emits `use_verified_browser_adapter`.
- Dependency failure: expose `mcporter` or set `BROWSER_USE_MCPORTER_COMMAND_JSON`.
- Config stale: update config to the verified Warm Chrome endpoint.
- Output failure: inspect selected adapter output before browser action.
