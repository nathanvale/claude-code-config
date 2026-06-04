---
name: fallow
description: "Run Fallow code-quality self-review."
---

# Fallow

Use after implementation, cleanup, or review prep when JS/TS code needs
Fallow analyzer evidence.

## Owner

- Runner: `skills/fallow/scripts/fallow-runner.ts`.
- Public command contract, result vocab, and repair action ids: `skills/fallow/scripts/command-contract.ts`.
- Runner tests: `skills/fallow/scripts/fallow-runner.test.ts`.
- Live compatibility smoke: `skills/fallow/scripts/fallow-runner.live.test.ts`.
- Command recipes: `skills/fallow/references/commands.md`.
- Workflow recipes: `skills/fallow/references/workflows.md`.
- Safety policy: `skills/fallow/references/safety.md`.
- CI adoption notes: `skills/fallow/references/ci.md`.
- Source lineage: `skills/fallow/PROVENANCE.md`.

## Workflow

- Run `doctor` first when Fallow availability, repo shape, git readiness, or config scope is unknown.
- Choose one evidence command for the current question.
- Use `commands.md` for mode selection and `--help` for exact syntax.
- Parse the runner JSON from stdout.
- Follow runner repair hints before retrying blocked runs.
- Rerun the same evidence command after code changes.
- Report before/after summary when a rerun exists.

## Safety

- Read `references/safety.md` before mutation.
- Stop before `fix-apply` unless current-task user authorization exists.
- Keep install, telemetry, watch, baseline, CI generation, and cross-skill orchestration outside this workflow.

## References

- Read `references/commands.md` for mode selection and help pointers.
- Read `references/workflows.md` for self-review, cleanup, preview, apply, and rerun loops.
- Read `references/safety.md` for the mutation boundary and trust rules.
- Read `references/ci.md` only for adoption guidance; CI setup is reference-only in v1.
