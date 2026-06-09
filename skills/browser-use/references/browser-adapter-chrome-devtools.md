# Browser Adapter Map: chrome-devtools

Use when Browser Adapter Proof emits a `chrome-devtools` dependency, config, binding, or output recovery action.

## Owners

- Proof runtime: `skills/browser-use/src/preflight-browser-adapter.ts`.
- Proof front door: `skills/browser-use/package.json#bin` (`preflight-browser-adapter`).
- Command contract: `skills/browser-use/src/command-contract.ts`.
- Warm Chrome map: `skills/browser-use/references/warm-chrome.md`.

## Rules

- Verify Warm Chrome first.
- Follow the proof continuation.
- Let Browser Adapter Proof classify dependency, config, binding, and output failures.
- Repair selected `chrome-devtools` config only after proof asks for it.
- Read proof diagnostics for selected source, path hint, and observed port.
- Repair one cause, rerun proof, then reroute.
- Do not repair a working setup because paths look surprising.
- Do not switch adapters or use cold-browser fallback after a proof constraint blocks fallback.

## Recovery Map

- Follow proof `continuation.next_action_id`.
- Treat Browser Entry Handoff as a return to `skills/browser-use/references/warm-chrome.md`.
- Add verified Adapter Proof to Router evidence before action.
- Read proof diagnostics before choosing dependency, config, input, or inspection repair.
- Use the sections below only after proof continuation points there.
- Stop before action when proof says binding is ambiguous, output is unparsable, command failed, config parsing failed, or proof timed out.
- Treat weak adapter signal as warning-only when proof status is `ok`.
- Return to Warm Chrome proof when proof reports Chrome for Testing or adapter auto-launch risk.

## Operator Choice

- If proof emits `continuation.requires_operator=true`, present its choices.
- Do not pick install, override, or native-config repair for the human.
- Use proof diagnostics and current command help for exact repair syntax.

## Dependency

- Expose `mcporter` on `PATH`; or set one explicit command vector.
- Treat package runners as operator choices, not automatic fallback.
- Use JSON array command vectors only.
- Unset the command-vector override when the shape is wrong.
- Keep a working command vector when failure names Chrome DevTools MCP instead of `mcporter`.

## Config

- Use `mcporter` config as the proofable `chrome-devtools` surface.
- Prefer a browser URL binding to verified Warm Chrome.
- Use a loopback HTTP endpoint on the verified port.
- Treat other hosts, `https`, and stale ports as binding failures.
- Add home config when proof emits `adapter_config_missing`.
- Overwrite stale or mismatched config with the verified port.
- Use project scope only when proof diagnostics or operator intent name project config.

- If a native MCP source is stale while `mcporter` is healthy, treat it as warning-only.
- If native MCP is the only named source, add or repair `mcporter` first, then rerun proof.
- Do not hand-edit native JSON or TOML unless proof still blocks after `mcporter` repair and the operator approves.
- Accept auto-connect user-data-dir config only when proof resolves its `DevToolsActivePort` file to verified Warm Chrome.

## Inspect

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

- Run `preflight-browser-adapter check` after Warm Chrome proof.
- Pass: proof emits verified adapter continuation.
- Dependency failure: expose `mcporter` or set the command-vector override.
- Config stale: update config to the verified Warm Chrome endpoint.
- Output failure: inspect selected adapter output before browser action.
