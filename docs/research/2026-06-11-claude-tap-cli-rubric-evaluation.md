---
title: claude-tap CLI Rubric Evaluation
date: "2026-06-11"
timezone: Australia/Melbourne
status: draft
source:
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md
  - https://github.com/liaohch3/claude-tap/tree/v0.1.108
  - https://github.com/liaohch3/claude-tap
  - /tmp/claude-tap-v0.1.108-agent-cli-eval/pyproject.toml
  - /tmp/claude-tap-v0.1.108-agent-cli-eval/claude_tap/cli.py
  - /tmp/claude-tap-v0.1.108-agent-cli-eval/claude_tap/export.py
  - /tmp/claude-tap-v0.1.108-agent-cli-eval/claude_tap/trace_store.py
  - /tmp/claude-tap-v0.1.108-agent-cli-eval/docs/support-matrix.md
---

# claude-tap CLI Rubric Evaluation

Use this evaluation as the sixth filled example for `docs/research/2026-06-11-agent-cli-evaluation-rubric.md`.

## Tool

- Name: `claude-tap`.
- Installed command: not installed locally.
- Version evaluated: `0.1.108`.
- Public surface: agent-trace proxy and local trace viewer CLI.
- Source: `https://github.com/liaohch3/claude-tap/tree/v0.1.108`.
- Local source used for structure: `/tmp/claude-tap-v0.1.108-agent-cli-eval`.

## Invocation Chain

- PyPI package exposes console script `claude-tap`.
- Console script maps to `claude_tap.cli:main_entry`.
- `main_entry` dispatches:
  - `export`
  - `update`
  - `trust-ca`
  - `dashboard`
  - default proxy/client launch flow
- Python runtime owns parser, proxy, trace store, viewer, and export behavior.

## Classification

- Public command surface: Agent-native utility CLI.
- Hidden or internal machine seams: local proxy, SQLite trace store, compact trace format, prompt snapshot, live viewer, and client launch adapters.
- Installed wrapper chain: Source-only evidence; package entrypoint is thin.
- Source architecture: Python package with separate CLI, proxy, client launch, trace storage, viewer/export, dashboard, prompt snapshot, usage, certs, and tests.

## Scores

- Wrapper: `2`.
- Command contract: `1`.
- Protocol seams: `2`.
- Discovery and registry: `1`.
- Repair and recovery: `1`.
- Observability: `2`.
- Folder structure and ownership: `2`.

Total: `11 / 14`.

Interpretation:

- Strong agent-native trace utility.
- Strong inspect/export/viewer loop.
- Strong source ownership and test matrix.
- Command discovery remains argparse/prose based.
- Trace discovery is useful, but no machine-readable session-list command was found.
- Recovery is helpful human text rather than a structured envelope.

## Evidence

### Wrapper

- `pyproject.toml` defines:
  - package name `claude-tap`
  - script `claude-tap = "claude_tap.cli:main_entry"`
- `main_entry` delegates to named subcommand owners.
- No wrapper-level parser duplication was found.
- Local help could not be run without installing dependencies:
  - repo pins Python `3.13` via `.python-version`
  - local pyenv exposes Python `3.11.9`
  - running with Python `3.11.9` failed on missing `aiohttp`

Score: `2`.

Reason:

- Package entrypoint is thin.
- Runtime behavior lives in Python modules.

### Command Contract

- Default parser is `argparse`.
- `export`, `dashboard`, `trust-ca`, and `update` are manually dispatched before default parsing.
- `parse_known_args` forwards unknown flags to the selected client.
- Public options include:
  - `--tap-client`
  - `--tap-target`
  - `--tap-proxy-mode`
  - `--tap-no-launch`
  - `--tap-output-dir`
  - `--tap-max-traces`
  - `--tap-store-stream-events`
  - `--tap-export-prompt`
  - `--tap-no-update-check`
- `export` has its own parser and supports `markdown`, `json`, `html`, `compact`, and `prompt-md`.
- No command catalog or parser/help/machine-output alignment proof was found.

Score: `1`.

Reason:

- Argparse help is serviceable.
- Dispatch is split across manual branches.
- Agents still need parser source or help text to discover capabilities.

### Protocol Seams

- Core runtime is a local HTTP forward/reverse proxy.
- Forward proxy supports CONNECT/TLS termination.
- Reverse proxy forwards provider-compatible API traffic.
- Trace store persists sessions, records, proxy logs, summaries, and compact blobs in SQLite.
- `export --format json` emits normalized trace JSON.
- `export --format compact` emits compact trace bundles.
- `export --format prompt-md` emits a prompt snapshot.
- Live dashboard and HTML viewer expose inspectable trace state.
- Client adapters support Claude Code, Codex CLI, Gemini CLI, Kimi, OpenCode, Pi, Hermes, Cursor, Qoder, Antigravity, and CodeBuddy.

Score: `2`.

Reason:

- The product is built around explicit machine seams.
- Agents can capture, export, diff, and inspect traces without scraping a terminal UI.

### Discovery And Registry

- README lists supported clients and quick-start examples.
- `docs/support-matrix.md` names client/auth/target/transport combinations and verification methods.
- `CLIENT_CONFIGS` owns default proxy modes and target detection.
- `dashboard` browses local trace history.
- `export --session-id` exports a stored SQLite session when the id is known.
- No CLI command was found for bounded machine-readable session listing.
- No `discover --json` style command was found for client capabilities.

Score: `1`.

Reason:

- Discovery is strong in docs and source.
- CLI discovery is not yet agent-parseable enough.

### Repair And Recovery

- `--tap-allow-path` validation rejects empty, non-absolute, root, and trailing-slash prefixes.
- `--tap-trust-ca` errors if used outside forward proxy mode.
- macOS CA trust path avoids sudo and System keychain writes.
- `dashboard stop` reports not-running and unable-to-stop states.
- Export reports missing trace files, missing sessions, invalid records, and HTML generation failure.
- Startup update check is gated by `--tap-no-update-check` and `--tap-no-auto-update`.
- No structured failure output was found with retry safety, side-effect state, diagnostics pointer, or next action id.

Score: `1`.

Reason:

- Human recovery is practical.
- Agent recovery is not yet a uniform contract.

### Observability

- Each run creates a trace session id.
- Runtime prints trace database path.
- SQLite store persists records and proxy logs.
- Trace summary reports:
  - API calls
  - token counts
  - session id
  - database path
  - dashboard URL when active
- Common auth headers are redacted before recording per README.
- `--tap-store-stream-events` can persist raw SSE/WebSocket events.
- Viewer and export surfaces expose system prompts, messages, tool schemas, tool calls, responses, token usage, and diffs.

Score: `2`.

Reason:

- Observability is the main product surface.
- The trace lifecycle is inspectable and shareable.

### Folder Structure And Ownership

- CLI:
  - `claude_tap/cli.py`
- Client launch:
  - `claude_tap/cli_clients.py`
- Proxy:
  - `claude_tap/proxy.py`
  - `claude_tap/forward_proxy.py`
  - `claude_tap/ws_proxy.py`
- Trace storage:
  - `claude_tap/trace.py`
  - `claude_tap/trace_store.py`
  - `claude_tap/compact_trace.py`
- Export and viewer:
  - `claude_tap/export.py`
  - `claude_tap/viewer.py`
  - `claude_tap/viewer_assets/`
- Dashboard:
  - `claude_tap/dashboard.py`
  - `claude_tap/shared_dashboard.py`
  - `claude_tap/live.py`
- Prompt snapshot:
  - `claude_tap/prompt_snapshot.py`
- Tests:
  - `tests/`
  - `tests/e2e/`
- Support matrix:
  - `docs/support-matrix.md`

Score: `2`.

Reason:

- Ownership boundaries are clear.
- Tests map directly to supported clients and proxy modes.

## Copy

- Treat inspect/export/viewer as one loop.
- Persist trace records in a local SQLite store.
- Provide compact trace and prompt snapshot exports.
- Keep client launch adapters explicit and tested.
- Make support matrix rows part of the maintenance contract.

## Avoid

- Do not leave trace session discovery only in dashboard UI.
- Do not make command capability discovery depend on README examples.
- Do not hide update checks in smoke paths without an explicit disable flag.

## Candidate Decisions

- Trace utilities should expose `sessions list --json` or equivalent.
- Trace exports should include compact, full JSON, human Markdown, and prompt-only formats.
- Support matrices should name client, auth mode, target, transport, default proxy mode, and verification method.

## Unresolved

- Verify installed `claude-tap --help` and `claude-tap export --help` after installing dependencies in an isolated environment.
- Check whether latest `claude-tap` exposes machine-readable session listing or capability discovery.
