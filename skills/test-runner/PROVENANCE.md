# Provenance: test-runner

- Origin: first-party skill in this repo.
- Active plan: `docs/plans/2026-06-04-003-feat-test-runner-compact-runner-plan.md`.
- Requirements source: `docs/brainstorms/2026-06-04-test-runner-compact-runner-requirements.md`.
- Decision log: `docs/decisions/2026-06-04-test-runner-compact-runner-decision-log.md`.
- Glossary owner: `CONTEXT.md`.

## Status

- Proof-only skill prose landed with local runner scripts.
- Normal test guidance remains `context/bun-runner.md`.
- MCP deprecation needs reviewed fixed-gate benchmark evidence.
- U5 benchmark ran: local runner passed exit and fidelity gates.
- U5 adoption result: keep MCP guidance unchanged; MCP artifact rows beat local token estimates where comparable, and timeout MCP evidence is missing.
- Follow-up variant example: compare a smaller failure-context budget against the same fixtures with the Runner Benchmark Harness.

## Owners

- `SKILL.md`: routing and next safe action.
- `scripts/command-contract.ts`: command contract and discovery metadata.
- `scripts/test-runner.ts`: parser, result model, renderer, and runtime behavior.
- `scripts/test-runner.sh`: stable entrypoint and missing-runtime preflight.
- `scripts/test-runner.test.ts`: help, parser, runtime, and wrapper proof.
- `scripts/test-runner.benchmark.ts`: Runner Benchmark Harness.
