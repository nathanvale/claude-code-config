---
title: Aider CLI Rubric Evaluation
date: "2026-06-11"
timezone: Australia/Melbourne
status: draft
source:
  - docs/research/2026-06-11-agent-cli-evaluation-rubric.md
  - docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md
  - https://github.com/Aider-AI/aider/tree/v0.86.2
  - https://github.com/Aider-AI/aider
  - https://aider.chat/docs/config/options.html
  - /opt/homebrew/Cellar/aider/0.86.2/libexec/bin/aider
  - /opt/homebrew/Cellar/aider/0.86.2/libexec/lib/python3.12/site-packages/aider/main.py
  - /tmp/aider-v0.86.2-agent-cli-eval/aider/args.py
  - /tmp/aider-v0.86.2-agent-cli-eval/aider/main.py
  - /tmp/aider-v0.86.2-agent-cli-eval/tests/basic/test_scripting.py
---

# Aider CLI Rubric Evaluation

Use this evaluation as the fifth filled example for `docs/research/2026-06-11-agent-cli-evaluation-rubric.md`.

## Tool

- Name: Aider.
- Installed command: `aider`.
- Version: `aider 0.86.2`.
- Installed path: `/opt/homebrew/bin/aider`.
- Public surface: human-first AI pair-programming CLI with scripting flags.
- Source: `https://github.com/Aider-AI/aider/tree/v0.86.2`.
- Local source used for structure: `/tmp/aider-v0.86.2-agent-cli-eval`.

## Invocation Chain

- `/opt/homebrew/bin/aider`.
- Symlink to `/opt/homebrew/Cellar/aider/0.86.2/bin/aider`.
- Python console script invokes `/opt/homebrew/Cellar/aider/0.86.2/libexec/bin/python`.
- Script imports `aider.main:main`.
- Python runtime owns parser and behavior.

## Classification

- Public command surface: Human CLI with script-friendly flags.
- Hidden or internal machine seams: model metadata, edit formats, repo map, history files, and LLM transcript files.
- Installed wrapper chain: Thin Python entrypoint.
- Source architecture: Python package organized around args, main flow, coders, repo map, commands, models, IO, linter/test, analytics, and tests.

## Scores

- Wrapper: `2`.
- Command contract: `1`.
- Protocol seams: `0`.
- Discovery and registry: `1`.
- Repair and recovery: `1`.
- Observability: `1`.
- Folder structure and ownership: `2`.

Total: `8 / 14`.

Interpretation:

- Strong mature human CLI.
- Useful scripting flags exist.
- Public surface is not agent-native.
- No stable JSON protocol, event stream, or recovery envelope was found.
- Source ownership is clear enough for future agents to navigate.

## Evidence

### Wrapper

- `aider --version` returns `aider 0.86.2` with exit `0`.
- `/opt/homebrew/bin/aider` is a symlink to the Homebrew package script.
- The script:
  - imports `sys`
  - imports `aider.main:main`
  - normalizes `sys.argv[0]`
  - exits with `main()`
- The wrapper does not reimplement parser or command behavior.

Score: `2`.

Reason:

- Wrapper is thin.
- Product behavior lives in Python package code.

### Command Contract

- CLI uses `configargparse.ArgumentParser`.
- Help and parser share argparse metadata.
- The command surface is one large option set rather than a subcommand tree.
- Help exposes environment variable names and config-file precedence.
- `--shell-completions bash` generates a completion script from parser metadata.
- No `discover --json` or command metadata catalog was found.
- No shared parser/help/machine-output contract was found.

Score: `1`.

Reason:

- Parser-owned help is solid.
- Completion generation proves useful metadata reuse.
- Agents still need to scrape prose and flags.

### Protocol Seams

- `--message` and `--message-file` support one-shot scripting.
- `--apply` applies edits from a file.
- `--dry-run` previews edits.
- `--show-repo-map` and `--show-prompts` expose internal material as human text.
- `--llm-history-file` can record the LLM conversation.
- No `--json` mode was found.
- No JSONL event stream, stdio protocol, WebSocket protocol, or schema output was found.

Score: `0`.

Reason:

- Scripting exists.
- Protocol-grade seams are not public.

### Discovery And Registry

- `aider --help` exposes the full option surface.
- `aider --list-models gpt-4` lists matching models as text.
- `aider --shell-completions bash` emits parser-derived shell completion data.
- Help names config file search paths and config precedence.
- A probe in a non-git temp directory prompted and created a git repo by default.
- Discovery commands are human text and can have startup side effects unless carefully gated.

Score: `1`.

Reason:

- Discovery is available for humans.
- Discovery is not bounded, parseable, or side-effect-free enough for agents by default.

### Repair And Recovery

- Unknown flag returns argparse usage and `unrecognized arguments`.
- Invalid argparse choices exit with status `2`.
- Startup flow detects missing model and API key.
- Missing model/API key can trigger OpenRouter OAuth onboarding.
- `--dry-run` exists for write preview.
- `--yes-always` bypasses confirmations.
- No structured recovery fields were found for retry safety, side effects, diagnostics, or next action.

Score: `1`.

Reason:

- Human repair guidance exists.
- Agent repair remains prompt and prose driven.

### Observability

- Public observability flags include:
  - `--verbose`
  - `--llm-history-file`
  - `--chat-history-file`
  - `--input-history-file`
  - `--analytics-log`
  - `--show-diffs`
  - `--stream`
  - `--no-stream`
- `--no-pretty` and dumb-terminal detection reduce terminal formatting.
- No run correlation id was observed.
- No structured failure output was observed.
- Analytics state is persisted under the user's Aider data directory.

Score: `1`.

Reason:

- Logs and history are useful for humans.
- Agents do not get a stable run envelope.

### Folder Structure And Ownership

- Parser:
  - `aider/args.py`
  - `aider/args_formatter.py`
- Runtime:
  - `aider/main.py`
- Chat/edit engines:
  - `aider/coders/`
- Repo map:
  - `aider/repomap.py`
- Model metadata:
  - `aider/models.py`
  - `aider/resources/model-metadata.json`
  - `aider/resources/model-settings.yml`
- Commands:
  - `aider/commands.py`
- IO/history:
  - `aider/io.py`
  - `aider/history.py`
- Tests:
  - `tests/basic/`
  - `tests/help/`
  - `tests/browser/`

Score: `2`.

Reason:

- Source boundaries are legible.
- Future agents can find parser, runtime, model, coder, and test owners.

## Copy

- Keep Python console wrappers tiny.
- Generate shell completions from parser metadata.
- Put model metadata in package resources.
- Offer `--dry-run` for edit workflows.

## Avoid

- Do not let read/discovery probes create git repos by default.
- Do not make model onboarding part of a nominal `--exit` smoke path.
- Do not rely on a huge single help page as the only command map.

## Candidate Decisions

- Discovery commands should be read-only by default.
- CLI smoke commands should avoid auth, onboarding, git mutation, update checks, and analytics writes.
- Completion metadata is useful, but not a substitute for an agent command catalog.

## Unresolved

- Check whether newer Aider releases add JSON output, MCP/ACP-like protocol modes, or structured scripting results.
- Decide whether human-first coding agents belong in the same score table as agent-native utility CLIs.
