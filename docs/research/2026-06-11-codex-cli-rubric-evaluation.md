---
title: Codex CLI Rubric Evaluation
date: "2026-06-11"
timezone: Australia/Melbourne
status: draft
source:
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md
  - https://github.com/openai/codex/tree/rust-v0.139.0
  - /Users/nathanvale/.local/share/fnm/node-versions/v24.11.1/installation/lib/node_modules/@openai/codex/package.json
  - /Users/nathanvale/.local/share/fnm/node-versions/v24.11.1/installation/lib/node_modules/@openai/codex/bin/codex.js
  - /tmp/codex-rust-v0.139.0-agent-cli-eval/codex-rs/cli/src/main.rs
  - /tmp/codex-rust-v0.139.0-agent-cli-eval/codex-rs/exec/src/cli.rs
  - /tmp/codex-rust-v0.139.0-agent-cli-eval/codex-rs/cli/src/doctor.rs
---

# Codex CLI Rubric Evaluation

Use this evaluation as the third filled example for `docs/research/2026-06-11-agent-cli-evaluation-rubric.md`.

## Tool

- Name: Codex CLI.
- Installed command: `codex`.
- Version: `codex-cli 0.139.0`.
- Installed path: `/Users/nathanvale/.local/state/fnm_multishells/21400_1781139065282/bin/codex`.
- Public surface: mixed human and agent CLI.
- Source: `https://github.com/openai/codex/tree/rust-v0.139.0`.
- Local source used for structure: `/tmp/codex-rust-v0.139.0-agent-cli-eval`.

## Invocation Chain

- `/Users/nathanvale/.local/state/fnm_multishells/21400_1781139065282/bin/codex`.
- Symlink to `../lib/node_modules/@openai/codex/bin/codex.js`.
- JS wrapper detects platform and architecture.
- JS wrapper selects optional package `@openai/codex-darwin-arm64`.
- Native Rust binary runs from `vendor/aarch64-apple-darwin/bin/codex`.

## Classification

- Public command surface: Mixed human CLI and agent-native CLI.
- Hidden or internal machine seams: protocol seams plus internal support commands.
- Installed wrapper chain: Thin JS wrapper over native Rust binary.
- Source architecture: Strong agent-native Rust workspace with separate protocol, runtime, app server, plugin, MCP, SDK, and observability owners.

## Scores

- Wrapper: `2`.
- Command contract: `1`.
- Protocol seams: `2`.
- Discovery and registry: `2`.
- Repair and recovery: `1`.
- Observability: `2`.
- Folder structure and ownership: `2`.

Total: `12 / 14`.

Interpretation:

- Strong agent-native runtime.
- Strong public protocols and generated contracts.
- Strong discovery through doctor, MCP, plugin, feature, and schema surfaces.
- Repair is useful but not yet a uniform recovery envelope.
- Public CLI is not backed by a single command contract or agent catalog.

## Evidence

### Wrapper

- `codex --version` returns `codex-cli 0.139.0` with exit `0`.
- Installed package version is `0.139.0`.
- Official tag `rust-v0.139.0` resolves to the inspected source commit.
- JS wrapper maps platform and architecture to a platform package.
- JS wrapper falls back to bundled `vendor/` lookup.
- JS wrapper sets:
  - `CODEX_MANAGED_BY_NPM`
  - `CODEX_MANAGED_PACKAGE_ROOT`
- JS wrapper forwards argv to the native binary.
- JS wrapper forwards common termination signals.
- JS wrapper mirrors child exit code or signal.
- Missing platform package error names the reinstall command.

Score: `2`.

Reason:

- Wrapper stays boring.
- Product behavior lives in the native Rust runtime.
- Wrapper failure names the missing optional dependency and repair path.

### Command Contract

- Top-level help is generated from clap.
- Public commands include:
  - `exec`
  - `review`
  - `mcp`
  - `plugin`
  - `mcp-server`
  - `app-server`
  - `remote-control`
  - `doctor`
  - `sandbox`
  - `debug`
  - `features`
- `review` routes through the `exec` runtime with review arguments.
- `mcp`, `plugin`, `doctor`, `app-server`, `exec-server`, and `features` delegate to named owners.
- Help and parser share clap metadata.
- No reusable facade-backed command contract was found.
- No global command catalog or `discover --json` equivalent was found.
- Top-level unknown words are treated as an interactive prompt, so `codex frobnicate` in non-TTY returned `Error: stdin is not a terminal` instead of an unknown-command category.

Score: `1`.

Reason:

- Dispatcher is thin enough for a Rust CLI.
- Runtime owners are separated.
- Agent command discovery still depends on help text and source knowledge.
- Help and parser share clap metadata, but no full command contract is exposed.

### Protocol Seams

- `codex exec --json` emits JSONL events to stdout.
- `codex exec --output-schema <FILE>` constrains final response shape.
- `codex mcp-server` starts Codex as an MCP server over stdio.
- `codex app-server` supports `stdio://`, `unix://`, `ws://IP:PORT`, and `off`.
- `codex app-server generate-json-schema --out /tmp/codex-app-schema-eval-20260611` succeeded and wrote `258` JSON schema files.
- `codex app-server generate-ts --out <DIR>` exists for TypeScript protocol bindings.
- `codex exec-server` exposes an experimental standalone service over WebSocket or stdio.
- Source protocol types derive serialization and JSON schema traits.
- Source SDKs exist under:
  - `sdk/typescript/`
  - `sdk/python/`

Score: `2`.

Reason:

- Machine seams are public and schema-backed.
- Agents can use JSONL, MCP, app-server, generated schema, and SDK paths without scraping TUI output.

### Discovery And Registry

- `codex doctor --json` emits a redacted machine-readable report with:
  - schema version
  - generated timestamp
  - overall status
  - CLI version
  - keyed checks
  - categories
  - statuses
  - summaries
  - details
  - issues
  - remediation
  - durations
- `doctor --json` reported the installed version as `0.139.0`.
- `doctor --json` reported installation, runtime, search, config, auth, MCP, sandbox, git, state, terminal, network, websocket, app-server, and update checks.
- `codex mcp list --json` emits configured servers, transports, enabled state, timeouts, and auth status.
- `codex mcp get --json <NAME>` exists for one server.
- `codex plugin list --json` emits installed plugins, versions, enabled state, source, marketplace source, install policy, and auth policy.
- `codex plugin list --available --json` requires JSON for available marketplace plugins.
- `codex features list` emits known feature flags with stage and effective state.
- `codex debug models --bundled` can dump the bundled model catalog as JSON.

Score: `2`.

Reason:

- Runtime, plugin, MCP, feature, and diagnostic state are discoverable.
- Several discovery surfaces are parseable.
- Top-level command discovery is still help-text-based.

### Repair And Recovery

- `codex doctor --json` is read-mostly and reports remediation on failing or warning checks.
- Doctor source says checks should inspect state without repair or long-lived services.
- Doctor warning rows can include structured issue fields:
  - severity
  - cause
  - measured
  - expected
  - remedy
- Nested unknown command returns a concise clap error:
  - `codex mcp frobnicate`
  - exit `2`
- Missing required argument returns a concise clap error:
  - `codex app-server generate-json-schema`
  - exit `2`
- Flag dependency failure returns a concise clap error:
  - `codex plugin list --available`
  - exit `2`
- Invalid `exec` flag under `--json` still returns plain clap text:
  - `codex exec --json --not-a-real-flag`
  - exit `2`
- `exec` JSONL error event carries a message, not a full recovery envelope.
- No uniform same-input retry safety, side-effect stance, or next-action id was found in CLI failures.

Score: `1`.

Reason:

- Doctor recovery is strong.
- Parser failures remain human-text errors.
- Runtime JSON errors are not yet a complete agent-native recovery contract.

### Observability

- `codex exec --json` emits typed JSONL thread events.
- JSONL event types include:
  - `thread.started`
  - `turn.started`
  - `turn.completed`
  - `turn.failed`
  - `item.started`
  - `item.updated`
  - `item.completed`
  - `error`
- `thread.started` includes a resumable thread id.
- `turn.completed` includes token usage.
- `codex exec --output-last-message <FILE>` can persist final output.
- `codex exec --ephemeral` can avoid session persistence.
- `codex debug prompt-input` renders model-visible prompt input as JSON.
- `codex debug models` renders the model catalog as JSON.
- `codex doctor --json` includes check durations.
- Source contains rollout trace owners for trace bundles, payloads, MCP correlation, inference, compaction, and reduced trace models.
- Source contains OpenTelemetry trace parent handling for `exec`.
- No public top-level run correlation id was observed in standard command output.

Score: `2`.

Reason:

- Event streams, diagnostics, trace internals, and debug JSON make observability a first-class concern.
- The main public gap is a consistent run correlation id and structured failure taxonomy.

### Folder Structure And Ownership

- JS package:
  - `codex-cli/`
  - `codex-cli/bin/codex.js`
- Native CLI:
  - `codex-rs/cli/`
- Non-interactive execution:
  - `codex-rs/exec/`
- Core runtime:
  - `codex-rs/core/`
- Protocol:
  - `codex-rs/protocol/`
  - `codex-rs/app-server-protocol/`
- App server:
  - `codex-rs/app-server/`
  - `codex-rs/app-server-client/`
  - `codex-rs/app-server-daemon/`
  - `codex-rs/app-server-transport/`
- MCP:
  - `codex-rs/mcp-server/`
  - `codex-rs/codex-mcp/`
  - `codex-rs/rmcp-client/`
- Plugins:
  - `codex-rs/plugin/`
  - `codex-rs/core-plugins/`
- Discovery and diagnostics:
  - `codex-rs/cli/src/doctor.rs`
  - `codex-rs/features/`
  - `codex-rs/install-context/`
- Observability:
  - `codex-rs/rollout-trace/`
  - `codex-rs/otel/`
- State and sessions:
  - `codex-rs/state/`
  - `codex-rs/thread-store/`
  - `codex-rs/external-agent-sessions/`
- SDKs:
  - `sdk/typescript/`
  - `sdk/python/`

Score: `2`.

Reason:

- Ownership surfaces are highly visible.
- CLI routing, runtime execution, protocol contracts, plugins, MCP, state, observability, and SDKs are distinct.
- Future agents can usually find the likely owner before editing.

## Copy

- Keep JS/package wrappers thin over one native runtime.
- Emit wrapper provenance env for diagnostics.
- Make `doctor --json` a redacted support artifact with keyed checks and remediation.
- Expose JSONL event streams for non-interactive agent runs.
- Include resumable thread ids in agent event streams.
- Provide app-server protocol schemas and TypeScript bindings from the runtime owner.
- Expose MCP server mode as a public CLI surface.
- Keep plugin and MCP discovery parseable.
- Organize runtime by owner crates, not only command names.
- Keep schema generation executable through the CLI.

## Avoid

- Letting global `--json` imply structured output for parser errors when clap still emits plain text.
- Treating top-level free text as prompt input when a non-interactive agent likely meant a command.
- Leaving command discovery as help text without a machine-readable catalog.
- Returning only `message` for JSONL fatal errors.
- Omitting same-input retry safety and next-action ids from failures.
- Letting plugin discovery expose local paths without a clear privacy posture.

## Candidate Decisions

- Agent-facing CLIs should provide `discover --json` or equivalent command metadata when command trees exceed a few subcommands.
- JSON mode should cover parser, config, and pre-runtime failures, not only runtime events.
- Public JSONL error events should include category, retry safety, side-effect state, diagnostics pointer, and next safe action.
- Doctor-style support reports should remain read-mostly and separate remediation reporting from mutating repair.
- Protocol schema generation should be a normal CLI command, not only a build script.
- Top-level prompt capture should have a non-interactive unknown-command guard when stdin is not a TTY.

## Unresolved

- Whether top-level prompt capture should stay as-is for human ergonomics.
- Whether command discovery belongs in clap metadata, app-server protocol, SDK metadata, or a new `discover` command.
- Whether plugin path output should be redacted or gated in JSON mode.
- Whether `exec --json` should include an explicit run id beyond thread id.
- Whether app-server schemas are stable enough to cite as public agent contracts outside experimental labeling.
