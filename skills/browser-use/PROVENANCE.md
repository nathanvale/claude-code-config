# Provenance: browser-use

Source: [steipete/agent-scripts](https://github.com/steipete/agent-scripts) — `skills/browser-use/`
License: MIT © 2026 Peter Steinberger (see `LICENSE.upstream`)
Pulled: 2026-05-29 (sparse checkout of `main`)

## Status: VERBATIM COPY — adaptation pending

`SKILL.md` and `mcporter-config.md` are unmodified upstream copies. Do not treat them as
finished for this repo yet — they carry steipete's personal specifics that need adapting:

- `mcporter-config.md` hardcodes `/Users/steipete/Library/Application Support/Google/Chrome`.
  Nathan's Chrome profile path differs; the agent-browser config already uses
  `~/.cache/chrome-agent` (debug port 9223). Reconcile before relying on it.
- The skill is hardwired to `chrome-devtools-mcp` via `mcporter`. Nathan also has an
  `agent-browser` CLI (wrapped by the side-quest browser-automation BSS). Open work: make the
  skill backend-agnostic (chrome-devtools-mcp OR agent-browser) per the record-replay thesis at
  `side-quest-engineering/docs/brainstorms/2026-05-29-001-two-skill-browser-automation-thesis.md`.

## Why it's here

steipete's `browser-use` + `one-password` are the lean-substrate existence proof behind the
two-skill record-then-replay design direction: thin skill over CDP + op-inject creds, reattach to
existing logged-in Chrome, no governance machinery. Kept as the substrate to build on; the
record/replay layer (the tape) is the net-new bet added on top.

## Local additions (not from upstream)

- `scripts/launch-agent-chrome.sh` — step-zero launcher. `--auto-connect` attaches but does not
  launch; this starts the agent Chrome on a known port (default 9223) against
  `~/.cache/chrome-agent` and writes a fresh `DevToolsActivePort` so chrome-devtools-mcp can attach.
  Idempotent (reuses a live browser). Added 2026-05-29 after proving the auth chain live on Oncore.

## Validated 2026-05-29

Full chain proven live on the real Oncore portal: launch agent Chrome → chrome-devtools MCP
`--auto-connect` → navigate → `one-password` op-read (secret never printed) → shell-side CDP fill →
authenticated dashboard ("Welcome: Nathan David Vale"). See
`side-quest-engineering/docs/brainstorms/2026-05-29-001-two-skill-browser-automation-thesis.md`
("Validated live, end-to-end") incl. the hard finding: the secret fill must stay inside the auth
boundary (never route a password through an MCP tool call).

## What this repo will change (track edits here as they land)

- [ ] De-hardcode the Chrome userDataDir / make it config-driven.
- [ ] Add an agent-browser CLI backend path alongside the mcporter/chrome-devtools-mcp path.
- [ ] (thesis) Add record-to-JSON-tape + replay; separate auth runbook; self-healing on DOM drift.
- [x] Step-zero launch script (`scripts/launch-agent-chrome.sh`).
