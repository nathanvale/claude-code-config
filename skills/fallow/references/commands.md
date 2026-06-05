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

- Use `audit --plain` first for implemented-work or PR-prep self-review when target fit is plausible.
- Use `doctor` when setup, repo shape, git readiness, JSON capability, or config scope is unknown on a plausible JS/TS target.
- Use `audit` for changed-code risk.
- Use `dead-code` for unused files, exports, types, or dependency cleanup evidence.
- Use `dupes` for duplicated-code evidence.
- Use `health` for complexity, coupling, and score evidence.
- Use `health` first for bare cleanup asks.
- Use `fix-preview` for write-inspection requests.
- Use `why` to trace one introduced export's reachability when an audit finding advertises a Finding resolver action.
- Discover resolver coordinates through runner help and command discovery.
- Read `references/safety.md` before applying Fallow fixes.

## Targeting

- Use the runner root input when the target repo differs from the current directory.
- Challenge or retarget suspect non-JS/TS roots before readiness checks.
- Let `audit` use Fallow defaults unless the current task needs an explicit base.
- Use subcommand help for accepted inputs.
- Treat unsupported control errors as input failures.

## Output

- Read plain summary output first for routine judgment.
- Use JSON for issue references, repair planning, structured evidence, and before/after comparison.
- Treat issue status as analyzer-finding evidence.
- Inspect issue references before editing files.
- Request raw parsed Fallow output only for inspection.
- Raise the JSON output budget when structured evidence is too large, or narrow the target when the caller needs a smaller context cap.
- Use runner help and tests for budget behavior.
- Follow repair hints when budget output is blocked.
