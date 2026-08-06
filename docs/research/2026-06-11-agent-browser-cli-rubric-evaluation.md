---
title: Agent Browser CLI Rubric Evaluation
date: "2026-06-11"
timezone: Australia/Melbourne
status: draft
source:
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md
  - https://github.com/vercel-labs/agent-browser/tree/v0.26.0
  - https://agent-browser.dev/
  - /Users/nathanvale/.bun/install/global/node_modules/agent-browser/package.json
  - /Users/nathanvale/.bun/install/global/node_modules/agent-browser/bin/agent-browser.js
---

# Agent Browser CLI Rubric Evaluation

Use this evaluation as the second filled example for `docs/research/2026-06-11-agent-cli-evaluation-rubric.md`.

## Tool

- Name: Agent Browser CLI.
- Installed command: `agent-browser`.
- Version: `0.26.0`.
- Installed path: `/Users/nathanvale/.bun/bin/agent-browser`.
- Public surface: agent-first browser automation CLI.
- Source: `https://github.com/vercel-labs/agent-browser/tree/v0.26.0`.
- Local source used for structure: `/tmp/agent-browser-v0.26.0`.

## Invocation Chain

- `/Users/nathanvale/.bun/bin/agent-browser`.
- Symlink to `/Users/nathanvale/.bun/install/global/node_modules/agent-browser/bin/agent-browser.js`.
- JS wrapper detects platform and architecture.
- JS wrapper selects bundled native binary, such as `agent-browser-darwin-arm64`.
- Native Rust binary runs the CLI.

## Classification

- Public command surface: Agent-native CLI.
- Hidden or internal machine seams: Native daemon protocol plus CDP and WebSocket streaming.
- Installed wrapper chain: Thin JS wrapper over native Rust binary.
- Source architecture: Strong Rust runtime with separate doctor, skills, output, native daemon, and dashboard surfaces.

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

- Strong explicit agent-first CLI.
- Strong skill/discovery surface.
- Strong observability primitives.
- Repair is much better than a normal CLI, but not yet a full agent-native recovery envelope.

## Evidence

### Wrapper

- `agent-browser --version` returns `agent-browser 0.26.0` with exit `0`.
- `~/.bun/bin/agent-browser` is a symlink to the package JS wrapper.
- The JS wrapper:
  - maps platform and architecture to a native binary
  - checks binary presence
  - fixes executable permission when needed
  - spawns the native binary
  - preserves exit code
- The wrapper does not reimplement command behavior.

Score: `2`.

Reason:

- Wrapper is boring in the good way.
- Wrapper failures are explicit about unsupported platform, missing binary, chmod failure, and reinstall/build repair.

### Command Contract

- `agent-browser --help` is explicitly agent-facing.
- It starts with `agent-browser skills get core --full`.
- It exposes a large command tree for navigation, interaction, debug, streaming, batch, auth, confirmation, sessions, chat, dashboard, setup, and profiles.
- Command parsing is runtime-owned in Rust under `cli/src/commands.rs`.
- Help output is maintained in `cli/src/output.rs`.
- There is no reusable facade-backed contract like `@side-quest/cli-command-facade`.
- `--json --help` and `--json --version` still emit human text.

Score: `1`.

Reason:

- The public help is strong for humans and agents.
- The score is not a penalty for weak agent-facing help.
- Help, parser, and JSON output can still drift because there is no shared command contract surface.
- Agent-facing prose earns discovery credit, but not a full command-contract score.

### Protocol Seams

- Public commands expose CDP attachment through `connect <port|url>` and `--cdp <port>`.
- Runtime WebSocket streaming is public through `stream enable`, `stream disable`, and `stream status`.
- `stream status --json` returns structured state.
- Native daemon logic lives under `cli/src/native/`.
- Command parsing builds JSON-like action payloads with request ids.
- The browser automation daemon owns actions, browser, CDP, snapshot, state, network, storage, tracing, and recording.

Score: `2`.

Reason:

- Machine seams are public and agent-discoverable.
- Agents can use the seams without source knowledge.

### Discovery And Registry

- `skills list --json` returns a stable list of bundled skills with names and descriptions.
- `skills get core --full` returns version-matched workflow guidance and command examples.
- `skills path core --json` returns the installed skill path.
- `session list --json` returns active sessions.
- `stream status --json` returns streaming state and port.
- `profiles --json` returns Chrome profile metadata.
- `doctor --json` returns check ids, categories, statuses, messages, fix hints, and summary counts.
- Source `cli/src/skills.rs` names the discovery directories:
  - `skills/`
  - `skill-data/`

Score: `2`.

Reason:

- Discovery is first-class and machine-readable.
- The bundled skill system is the standout agent-native idea.

### Repair And Recovery

- Unknown command in JSON mode returns:
  - `success: false`
  - `error`
  - `type: unknown_command`
- Missing argument in JSON mode returns:
  - `success: false`
  - `error`
  - `type: missing_arguments`
- `doctor --json` reports environment, Chrome, daemon, config, security, provider, network, and launch checks.
- `doctor --fix` gates destructive or mutating repair.
- Action policy and confirmation controls exist:
  - `--action-policy`
  - `--confirm-actions`
  - `--confirm-interactive`
  - `confirm`
  - `deny`
- `--json --config /tmp/missing.json session` emitted a plain-text config error instead of JSON.
- Errors do not consistently include same-input retry safety, side-effect labels, next action ids, or run correlation.

Score: `1`.

Reason:

- Recovery is strong for a public CLI.
- It is not yet a uniform structured recovery contract.

### Observability

- Public observability commands include:
  - `dashboard start`
  - `stream enable`
  - `stream status`
  - `trace start|stop`
  - `profiler start|stop`
  - `record start|stop`
  - `console`
  - `errors`
  - `inspect`
  - `diff`
- `doctor --json` gives structured readiness diagnostics.
- `--debug`, `--verbose`, and `--quiet` are public options.
- `--max-output` limits page output.
- `--content-boundaries` can mark page content with a nonce.
- JSON success and failure output is supported for many runtime commands.
- No top-level run correlation id was observed.

Score: `2`.

Reason:

- Observability is a first-class product surface.
- Missing run correlation is the biggest gap.

### Folder Structure And Ownership

- Root package and release:
  - `package.json`
  - `bin/`
  - `scripts/`
- Native CLI:
  - `cli/`
  - `cli/src/main.rs`
  - `cli/src/commands.rs`
  - `cli/src/flags.rs`
  - `cli/src/output.rs`
  - `cli/src/validation.rs`
- Doctor:
  - `cli/src/doctor/`
- Runtime:
  - `cli/src/native/`
- Bundled skills:
  - `skill-data/`
  - `skills/`
- Dashboard:
  - `packages/dashboard/`
- Docs:
  - `docs/`
- Evaluation:
  - `evals/`
- Benchmarks:
  - `benchmarks/`

Score: `2`.

Reason:

- Ownership surfaces are visible and easy to navigate.
- `AGENTS.md` explicitly names source owners for help, README, skill data, docs, and inline docs.

## Copy

- Put "start here for agents" at the top of help.
- Ship version-matched skills with the CLI.
- Make `skills list`, `skills get`, and `skills path` runtime commands.
- Keep thin wrapper over native runtime.
- Expose doctor/readiness checks with ids, categories, statuses, and fixes.
- Separate mutating repair behind an explicit `--fix`.
- Make observability commands first-class.
- Provide output budget controls.
- Use action confirmation as a first-class CLI concept.

## Avoid

- Letting `--json --help` and `--json --version` fall back to plain text when agents may expect structured output.
- Returning plain-text config errors under global `--json`.
- Emitting local profile names through JSON discovery without an explicit privacy posture.
- Relying on hand-maintained help and parser definitions without an alignment proof.
- Omitting run correlation from structured outputs.

## Candidate Decisions

- Agent-facing CLIs should ship version-matched runtime skills or recipes when command docs alone are insufficient.
- Runtime `doctor` output should use check ids, categories, status, fix hints, and summary counts.
- Global `--json` should cover pre-parser and config errors, not only parsed runtime commands.
- Agent observability should include an explicit run correlation id even when command-level request ids exist.
- Profile or account discovery should define a privacy posture before emitting names in machine output.

## Unresolved

- Whether `skills get` should be considered command discovery, workflow discovery, or both.
- Whether `--json --help` should emit command metadata or stay human text.
- Whether source should centralize help and parser definitions to prevent drift.
- Whether local profile names are acceptable in JSON discovery by default.
