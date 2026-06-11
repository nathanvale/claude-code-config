---
title: Playwright CLI Rubric Evaluation
date: "2026-06-11"
timezone: Australia/Melbourne
status: draft
source:
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md
  - /Users/nathanvale/.pyenv/versions/3.11.9/lib/python3.11/site-packages/playwright/__main__.py
  - /Users/nathanvale/.pyenv/versions/3.11.9/lib/python3.11/site-packages/playwright/_impl/_driver.py
  - /Users/nathanvale/.pyenv/versions/3.11.9/lib/python3.11/site-packages/playwright/driver/package/cli.js
  - /Users/nathanvale/.pyenv/versions/3.11.9/lib/python3.11/site-packages/playwright/driver/package/lib/cli/program.js
---

# Playwright CLI Rubric Evaluation

Use this evaluation as the first filled example for `docs/research/2026-06-11-agent-cli-evaluation-rubric.md`.

## Tool

- Name: Playwright CLI.
- Installed command: `playwright`.
- Version: `1.58.0`.
- Installed path: `/Users/nathanvale/.pyenv/versions/3.11.9/bin/playwright`.
- Public surface: human CLI.
- Hidden seams: protocol-grade machine seams.
- Wrapper: Python package entrypoint delegating to bundled Node driver.

## Invocation Chain

- `/Users/nathanvale/.pyenv/versions/3.11.9/bin/playwright`.
- `playwright.__main__:main`.
- `playwright._impl._driver.compute_driver_executable`.
- Bundled Node executable.
- `driver/package/cli.js`.
- `driver/package/lib/cli/programWithTestStub.js`.
- `driver/package/lib/cli/program.js`.

## Classification

- Public command surface: Human CLI.
- Hidden or internal machine seams: Hidden-protocol CLI.
- Installed wrapper chain: Thin wrapper over shared runtime.
- Source architecture: Strong seam architecture.

## Scores

- Wrapper: `2`.
- Command contract: `1`.
- Protocol seams: `1`.
- Discovery and registry: `1`.
- Repair and recovery: `1`.
- Observability: `0`.
- Folder structure and ownership: `2`.

Total: `8 / 14`.

Interpretation:

- Strong architecture.
- Strong hidden protocol seams.
- Useful but human-first discovery.
- Weak public agent contract.

## Evidence

### Wrapper

- `playwright --version` returns `Version 1.58.0` with exit `0`.
- Python wrapper preserves the Node process exit code.
- `_driver.py` sets:
  - `PW_LANG_NAME=python`
  - `PW_LANG_NAME_VERSION`
  - `PW_CLI_DISPLAY_VERSION`
- Wrapper does not reimplement command parsing.
- Wrapper computes the bundled `driver/package/cli.js` path.

Score: `2`.

Reason:

- The wrapper stays boring.
- Cross-language behavior is centralized in the bundled Node CLI.

### Command Contract

- Public help lists human commands:
  - `open`
  - `codegen`
  - `install`
  - `uninstall`
  - `install-deps`
  - `cr`
  - `ff`
  - `wk`
  - `screenshot`
  - `pdf`
  - `show-trace`
- CLI registration lives in `lib/cli/program.js`.
- Only three files live in `lib/cli/`:
  - `driver.js`
  - `program.js`
  - `programWithTestStub.js`
- Help and parser share Commander command definitions.
- There is no visible command contract, command catalog, or stable agent metadata.
- Python mode suppresses JS test stubs, so `playwright test` returns unknown command.

Score: `1`.

Reason:

- Dispatcher is thin enough.
- The surface is not backed by a command contract or stable agent metadata.

### Protocol Seams

- Hidden commands in `program.js` include:
  - `run-driver`
  - `run-server`
  - `print-api-json`
  - `launch-server`
- `run-driver` speaks JSON over stdio.
- `run-server` exposes a WebSocket server.
- `launch-server` prints a browser WebSocket endpoint.
- `print-api-json` emits generated API schema data.
- These seams are hidden from normal help.

Score: `1`.

Reason:

- The machine seams are real and strong.
- Agents need source knowledge or hidden command knowledge to discover them.

### Discovery And Registry

- `playwright install --help` advertises:
  - `--dry-run`
  - `--list`
  - `--force`
  - `--only-shell`
  - `--no-shell`
- `playwright install --dry-run chromium` prints:
  - browser artifact names
  - Playwright browser revisions
  - install locations
  - primary download URLs
  - fallback download URLs for FFmpeg
- `playwright install --list` prints:
  - Playwright versions
  - installed browser cache paths
  - references that own those caches
- Registry source lives under `lib/server/registry/`.

Score: `1`.

Reason:

- Discovery is very useful for agents.
- Output is plain human text, not a stable JSON contract.

### Repair And Recovery

- `playwright --json` returns `error: unknown option '--json'`, exit `1`.
- `playwright frobnicate` returns `error: unknown command 'frobnicate'`, exit `1`.
- `playwright screenshot` returns `error: missing required argument 'url'`, exit `1`.
- `playwright install definitely-not-a-browser` returns an invalid-target error with valid alternatives, exit `1`.
- `playwright install-deps --dry-run chromium` exits `0` on this macOS setup with no output.
- JS mode has helpful `@playwright/test` missing-capability stubs.
- Python mode suppresses those stubs, so `playwright test` is an unknown command.

Score: `1`.

Reason:

- Basic human recovery works for invalid browser names.
- Errors do not include structured category, same-input retry safety, side-effect labels, or next action ids.

### Observability

- No run correlation id.
- No structured failure envelope.
- No JSON mode for public commands tested.
- No explicit side-effect stance in output.
- Stdout and stderr behavior is conventional but not agent-contractual.
- No output-budget controls found in public help.

Score: `0`.

Reason:

- Good CLI conventions exist.
- Agent observability is not exposed.

### Folder Structure And Ownership

- CLI surface:
  - `lib/cli/`
- Client boundary:
  - `lib/client/`
- Server runtime:
  - `lib/server/`
- Protocol boundary:
  - `lib/protocol/`
- Remote boundary:
  - `lib/remote/`
- Generated artifacts:
  - `lib/generated/`
- Registry owner:
  - `lib/server/registry/`
- Dispatch adapter layer:
  - `lib/server/dispatchers/`

Score: `2`.

Reason:

- Runtime ownership is visible in folder structure.
- CLI files stay small relative to deeper runtime surfaces.

## Copy

- Keep wrapper entrypoints thin.
- Centralize command behavior in one runtime.
- Separate CLI command surface from runtime implementation.
- Keep protocol transport separate from human commands.
- Keep registry and install/cache ownership in its own surface.
- Provide dry-run and list commands for install/cache state.
- Register known missing capabilities with repair guidance.

## Avoid

- Hiding useful machine seams from agents.
- Making agents scrape human discovery output.
- Suppressing helpful missing-capability stubs by language mode.
- Treating a human CLI as agent-native because it has strong internal protocols.
- Leaving structured error categories, retry safety, and side-effect labels out of public output.

## Candidate Decisions

- Known capability stubs should remain available across language package wrappers unless a wrapper has a better language-specific recovery path.
- Discovery and registry commands should provide both human text and structured JSON.
- External CLI evaluation should keep a separate score for hidden protocol seams, because public help alone can understate architecture quality.

## Unresolved

- Whether Playwright's hidden protocol commands are intentionally unsupported for public use.
- Whether `print-api-json` has a smaller filtered mode elsewhere.
- Whether `install --dry-run` output is stable enough for scripts despite lacking JSON.
- Whether Python Playwright should expose test stubs with Python-specific guidance or keep `test` unknown.
