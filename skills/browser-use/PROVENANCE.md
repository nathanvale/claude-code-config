# Provenance: browser-use

Source: [steipete/agent-scripts](https://github.com/steipete/agent-scripts) — `skills/browser-use/`
License: MIT © 2026 Peter Steinberger (see `LICENSE.upstream`)
Pulled: 2026-05-29 (sparse checkout of `main`)

## Status: ADAPTED

`SKILL.md`, `references/warm-chrome.md`, and `mcporter-config.md` now carry this repo's
adapter-neutral Warm Chrome contract.

- Canonical owner: `browser-use`.
- Contract: real Google Chrome binary, dedicated persistent profile, loopback CDP, no Chrome for Testing.
- Current proof adapter: `chrome-devtools`.
- Future proof targets: `agent-browser`, `playwright-cdp`.
- Deterministic replay detail: `puppeteer-core` against a verified endpoint.

## Why it's here

steipete's `browser-use` + `one-password` are the lean-substrate existence proof: thin skill over
CDP + op-inject creds, reattach to existing logged-in Chrome, no governance machinery. This repo keeps
that substrate and adds a local Warm Chrome contract so browser-memory work consumes one owner.

## Local additions (not from upstream)

- `scripts/preflight-warm-chrome.sh` — thin Warm Chrome Preflight wrapper.
- `scripts/preflight-warm-chrome.ts` — Bun CLI runtime. `check` is read-only; `status` shows human
  health; `repair` owns safe profile repair; `launch` starts real Google Chrome only when needed.
- `scripts/command-contract.ts` — `create-cli` / facade contract for command surface, side effects,
  result contract, and action affordances.
- `scripts/preflight-warm-chrome.test.ts` — focused CLI behavior tests.
- `scripts/preflight-browser-adapter.sh` — thin Browser Adapter Proof wrapper.
- `scripts/preflight-browser-adapter.ts` — read-only adapter attachment proof. Runs Warm Chrome Preflight first.
- `scripts/preflight-browser-adapter.test.ts` — focused Browser Adapter Proof contract and `chrome-devtools` tests.
- `scripts/launch-agent-chrome.sh` — older step-zero launcher. `--auto-connect` attaches but does not
  launch; this starts real Google Chrome on a known port and writes `DevToolsActivePort` for
  chrome-devtools-mcp. Treat it as legacy helper under the Warm Chrome contract, not the contract.
- `references/warm-chrome.md` — canonical Warm Chrome contract.

## Validated 2026-05-29

Full chain proven live on the real Oncore portal: launch agent Chrome → chrome-devtools MCP
`--auto-connect` → navigate → `one-password` op-read (secret never printed) → shell-side CDP fill →
authenticated dashboard ("Welcome: Nathan David Vale"). See
`side-quest-engineering/docs/brainstorms/2026-05-29-001-two-skill-browser-automation-thesis.md`
("Validated live, end-to-end") incl. the hard finding: the secret fill must stay inside the auth
boundary (never route a password through an MCP tool call).

## Validated 2026-06-01

Evaluation confirmed historical incident context:

- `9444`: real Google Chrome, `~/.agent-warm-profile`, CDP responds.
- `9223`: real Google Chrome, actual profile `~/.agent-prose-replay-profile`.
- `mcporter` CLI was not on the shell path, but a `mcporter daemon` plus `chrome-devtools-mcp`
  process were running.
- Existing Chrome processes were not relaunched or killed.
- `preflight-warm-chrome.sh` spike proved facade-shaped JSON and live endpoint checks.
- Spike `check` repaired `~/.agent-warm-profile` from `0755` → `0700`; current CLI fixes that split.

CLI hardening confirmed:

- `command-contract.ts` validates through `defineCommandFacadeContract`.
- Error envelopes validate with `validateStructuredRuntimeError`.
- Focused Bun tests cover 108 public CLI cases across command contract, check, repair, launch,
  status, observability, usage failures, and edge recovery.
- Observability tests cover stdout envelope discipline, LogTape JSONL stderr diagnostics, quiet mode,
  error flush, and redaction-safe diagnostic context.
- `check` is read-only.
- `repair` owns safe `chmod` and `DevToolsActivePort` rewrite.
- `launch` does not spawn when endpoint already validates.
- `launch` validates persistent profile safety before spawning.
- Explicit `--endpoint` derives its own port when `--port` is absent.
- Runtime/dependency failures route to `inspect_diagnostics`, not browser-entry repair loops.
- Browser-entry failures emit specific recovery affordances alongside the hard-stop action.

## Validated 2026-06-02

- Browser Adapter Proof contract validates through `defineCommandFacadeContract`.
- `chrome-devtools` proof runs Warm Chrome Preflight internally.
- `chrome-devtools` proof accepts mcporter `--browserUrl` on verified `9222`.
- Stale mcporter config reports `adapter_config_stale` and `update_adapter_config`.
- Healthy mcporter plus stale native MCP config emits warning only.
- Missing PATH `mcporter`, configured runner, or Chrome DevTools MCP reports `adapter_dependency_missing`.
- Invalid `BROWSER_USE_MCPORTER_COMMAND_JSON` reports `adapter_command_override_invalid`.
- Proof timeout reports `adapter_proof_timeout`.

## Open Work

- [ ] Verify `agent-browser` against the Warm Chrome contract before documenting it as a default.
- [ ] Keep browser-domain-memory consuming this contract rather than duplicating it.
