# Fallow Commands

Use this as a recipe map. Exact runner flags, result fields, and repair action
literals live in `skills/fallow/scripts/command-contract.ts`, runner help, and
tests.

## Help

```bash
bun run skills/fallow/scripts/fallow-runner.ts --help
bun run skills/fallow/scripts/fallow-runner.ts <subcommand> --help
```

## Mode Map

- Use `doctor` when setup, repo shape, git readiness, JSON capability, or config scope is unknown.
- Use `audit` for changed-code risk.
- Use `dead-code` for unused files, exports, types, or dependency cleanup evidence.
- Use `dupes` for duplicated-code evidence.
- Use `health` for complexity, coupling, and score evidence.
- Use `fix-preview` before any Fallow fix apply request.
- Use `fix-apply` only after current-task user authorization.

## Targeting

- Pass `--root <repo>` when the target repo differs from the current directory.
- Let `audit` use Fallow defaults unless the current task needs an explicit base ref.
- Do not use public `--cwd`, `--mode`, watch, baseline, or CI-generation controls.

## Output

- Read the normalized summary first.
- Request raw parsed Fallow output only for inspection.
- Lower the output budget only when the caller needs a tighter context cap.
- Treat omitted raw output as intentional when summary evidence remains.

## Owner Paths

- Public command surface: `skills/fallow/scripts/command-contract.ts`.
- Parser and execution mapping: `skills/fallow/scripts/fallow-runner.ts`.
- Command surface proof: `skills/fallow/scripts/fallow-runner.test.ts`.
- Live compatibility proof: `skills/fallow/scripts/fallow-runner.live.test.ts`.
- Official Fallow commands: `https://docs.fallow.tools`.
