---
name: fallow
description: "Run Fallow code-quality self-review."
---

# Fallow

Use after implementation, cleanup, or review prep when JS/TS code needs
Fallow analyzer evidence.

## Owner

- Runner: `skills/fallow/scripts/fallow-runner.ts`.
- CLI contract, flags, result vocab, and repair actions: `skills/fallow/scripts/command-contract.ts`.
- Runner tests: `skills/fallow/scripts/fallow-runner.test.ts`.
- Live compatibility smoke: `skills/fallow/scripts/fallow-runner.live.test.ts`.
- Command recipes: `skills/fallow/references/commands.md`.
- Workflow recipes: `skills/fallow/references/workflows.md`.
- Safety policy: `skills/fallow/references/safety.md`.
- CI adoption notes: `skills/fallow/references/ci.md`.
- Source lineage: `skills/fallow/PROVENANCE.md`.

## Workflow

- Run `doctor` first when Fallow availability, repo shape, git readiness, or config scope is unknown.
- Choose one evidence command for the current question; use `commands.md` for the mode map.
- Parse the runner JSON from stdout.
- Follow runner repair hints before retrying blocked runs.
- Rerun the same evidence command after code changes.
- Report before/after summary when a rerun exists.

## Safety

- Treat `fix-preview` as the normal write-inspection path.
- Run `fix-apply` only after current-task user authorization.
- Never install Fallow, enable telemetry, run watch mode, create baselines, generate CI workflows, or invoke other skills from this workflow.
- Inspect config paths before mutation when the runner reports config presence.

## References

- Read `references/commands.md` for mode selection and help pointers.
- Read `references/workflows.md` for self-review, cleanup, preview, apply, and rerun loops.
- Read `references/safety.md` before any mutation.
- Read `references/ci.md` only for adoption guidance; CI setup is reference-only in v1.
