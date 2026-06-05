---
name: test-runner
description: "Prove or benchmark the skill-local Agent Runner."
---

# Test Runner

Proof-only Agent Runner for Bun test output.

## Status

- Use for runner proof, benchmark evidence, and output-contract development.
- Use repair mode for hot-context failures in files already being edited.
- Use triage mode for cold-context failures from broader suites or unopened files.
- Use detail lookup when a repair or triage packet lacks enough context.
- Keep routine test runs on `context/bun-runner.md` until adoption gates pass.
- Do not treat this skill as the default test path yet.

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
- For normal repo tests, read `context/bun-runner.md` and use the MCP runners.

## Workflow

- Start with the plan or benchmark question.
- Choose repair mode when the failing file is already in context.
- Choose triage mode when the failure source may be unopened.
- Use detail lookup with a source-run handle when the packet is too terse.
- Run the focused local runner only when proving this skill or comparing Agent Runner output.
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

- If adoption has not passed, gather mode-aware benchmark evidence.
- If adoption passed and evidence was reviewed, update `context/bun-runner.md`, `rules/code-quality.md`, and this routing text together.
