---
name: cli-execution-auditor
description: "Audit a facade-backed CLI's agent-execution experience against its lane contract. Use when verifying a facade CLI's exit codes, help-flag alignment, redaction, runner discipline, and --json-under-failure before shipping."
---

# CLI Execution Auditor

Opt-in tool that deterministically audits a facade-backed CLI against the
per-lane contract. Two check kinds — static contract assertions (no enumeration)
and facade-surface exercise (run each enumerable invocation, assert the clause).
Pass/fail is a fact derived from the contract, not a judge's vote. Scope is the
facade lane only.

## Owner Paths

- Lane contract owner (cited by reference, never copied): `runtime/cli-command-facade/AGENTS.md`
- Clause catalog (the load-bearing spec): `src/clause-catalog.ts`
- Human clause → code-owner map: `references/lane-contract-clauses.md`
- Findings-model semantics (states, dedupe, never-delete): `skills/skill-self-audit-loop/SKILL.md`

## Status

Scaffold. The audit engine (static + surface checks) lands in plan units U4/U5;
this skill currently declares the command surface and an auditor-local findings
ledger. The ledger is format-compatible with `skill-self-audit-loop`'s
findings-table template; a shared module is extracted only when a second code
consumer exists.

## Command

```text
auditor audit <target> [--only <clause>] [--ledger <path>] [--json]
```

Exit codes: `0` target clean, `1` lane-contract findings present, `2` usage error.
