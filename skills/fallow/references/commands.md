# Fallow Commands

Use this as a recipe map. Use runner help for exact current syntax.

Owner paths:

- Repo-local front door: `skills/fallow/package.json#scripts` (`fallow-runner`).
- Public command surface: `skills/fallow/src/command-contract.ts`.
- Parser and execution mapping: `skills/fallow/src/fallow-runner.ts`.
- Command surface proof: `skills/fallow/src/fallow-runner.test.ts`.
- Live compatibility proof: `skills/fallow/src/fallow-runner.live.test.ts`.
- Official Fallow commands: `https://docs.fallow.tools/llms.txt`.

## Help

```bash
cd skills/fallow
bun run fallow-runner --help
bun run fallow-runner <subcommand> --help
```

- Use the runner package script, not the raw `fallow` binary.
- JSON envelope output is default.
- Use `--plain` for compact summaries.
- Passing `--json` is accepted as an explicit default.

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

- Use `--root <repo>` when the target repo differs from the invocation directory.
- Do not pass positional targets.
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
- For broad JSON audit budget blocks, retry with a larger output budget or use `audit --plain` first.
- Use runner help and tests for budget behavior.
- Follow repair hints when budget output is blocked.
