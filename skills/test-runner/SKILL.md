---
name: test-runner
description: "Prove or benchmark the skill-local Agent Runner."
---

# Test Runner

Agent Runner for Bun test context.

## Status

- Use for Bun pass/fail, coverage, failure repair, triage, benchmark evidence, and output-contract development.
- Use compact mode for routine Bun test gates.
- Use repair mode for hot-context failures in files already being edited.
- Use triage mode for cold-context failures from broader suites or unopened files.
- Use detail lookup when a repair or triage packet lacks enough context.
- Keep lint, format, and type gates on MCP runners.
- Treat Agent Runner as the default Bun test path.

## Owner

- Skill prose: `skills/test-runner/SKILL.md`.
- Command contract and discovery: `skills/test-runner/scripts/command-contract.ts`.
- CLI, parser, result model, and runtime behavior: `skills/test-runner/scripts/test-runner.ts`.
- Detail artifact read/write behavior: `skills/test-runner/scripts/test-runner.ts`.
- Shell entrypoint and missing-runtime preflight: `skills/test-runner/scripts/test-runner.sh`.
- Tests: `skills/test-runner/scripts/test-runner.test.ts`.
- Runner Benchmark Harness: `skills/test-runner/scripts/test-runner.benchmark.ts`.
- Evidence output: `skills/test-runner/scripts/.benchmark-output/`.

## Commands

- Inspect exact runner usage: `skills/test-runner/scripts/test-runner.sh --help`.
- Inspect benchmark usage: `cd skills/test-runner/scripts && bun run test-runner.benchmark.ts --help`.
- Prove no-MCP Bun adoption: `cd skills/test-runner/scripts && bun run test-runner.benchmark.ts --no-mcp-baseline --local-runner ./test-runner.sh --mode fixed-gate --gate-preset bun-no-mcp`.
- For runner routing, read `context/bun-runner.md`.

## Workflow

- Start with the plan or benchmark question.
- Choose repair mode when the failing file is already in context.
- Choose triage mode when the failure source may be unopened.
- Use detail lookup with a source-run handle when the packet is too terse.
- Run the focused local runner for Bun test, coverage, repair, or triage context.
- Run the Runner Benchmark Harness before any guidance change.
- Require fixed-gate benchmark evidence before changing normal runner guidance.
- Keep lint and typecheck on current guidance.

## Safety

- Pass test-target args only after the runner separator.
- Keep generated evidence under the skill-local output path unless deliberately promoted.
- Keep generated detail under `skills/test-runner/scripts/.runner-output/` unless deliberately promoted.
- Do not copy flags, output schemas, parser states, or exit tables into this file.
- Use script help and tests for deterministic behavior.

## Next Safe Action

- For a routine Bun test gate, run compact mode.
- For coverage, pass Bun coverage args after `--`.
- For a failing edited test file, run repair mode and use detail lookup only if needed.
- For a broader failing suite, run triage mode and then narrow with compact or repair mode.
- For future guidance changes, run fixed-gate benchmark evidence first.
