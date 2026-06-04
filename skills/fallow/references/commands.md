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
- Pass public `--base-ref <ref>` for `audit`; the runner maps it to Fallow's base ref flag.
- Do not use public `--cwd`, `--mode`, watch, baseline, or CI-generation controls.

## Output

- Read the normalized summary first.
- Use `status: issues` only as analyzer-finding evidence.
- Inspect issue references for file, range, rule, category, action, or finding ids.
- Request raw parsed Fallow output only for inspection.
- Lower the output budget only when the caller needs a tighter context cap.
- Treat omitted raw output as intentional when summary evidence remains.
- Treat `raw-omitted` as complete summary evidence without raw payload.
- Treat `summary-impossible` as a budget failure; retry with a larger budget or no raw output.
- Do not expect partial raw-output truncation.

## Owner Paths

- Public command surface: `skills/fallow/scripts/command-contract.ts`.
- Parser and execution mapping: `skills/fallow/scripts/fallow-runner.ts`.
- Command surface proof: `skills/fallow/scripts/fallow-runner.test.ts`.
- Live compatibility proof: `skills/fallow/scripts/fallow-runner.live.test.ts`.
- Official Fallow commands: `https://docs.fallow.tools`.
