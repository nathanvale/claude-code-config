# Fallow Commands

Use this as a recipe map. Use runner help for exact current syntax.

Owner paths:

- Public command surface: `skills/fallow/scripts/command-contract.ts`.
- Parser and execution mapping: `skills/fallow/scripts/fallow-runner.ts`.
- Command surface proof: `skills/fallow/scripts/fallow-runner.test.ts`.
- Live compatibility proof: `skills/fallow/scripts/fallow-runner.live.test.ts`.
- Official Fallow commands: `https://docs.fallow.tools/llms.txt`.

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
- Use `fix-preview` for write-inspection requests.
- Read `references/safety.md` before applying Fallow fixes.

## Targeting

- Use the runner root input when the target repo differs from the current directory.
- Let `audit` use Fallow defaults unless the current task needs an explicit base.
- Use subcommand help for accepted inputs.
- Treat unsupported control errors as input failures.

## Output

- Read the normalized summary first.
- Treat issue status as analyzer-finding evidence.
- Inspect issue references before editing files.
- Request raw parsed Fallow output only for inspection.
- Tighten the output budget only when the caller needs a smaller context cap.
- Use runner help and tests for budget behavior.
- Follow repair hints when budget output is blocked.
