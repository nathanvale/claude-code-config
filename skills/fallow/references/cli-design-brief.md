# Fallow Runner CLI Design Brief

Historical brief. Active contract lives in code, help, generated output, and tests.

## Decision

- Use the Facade-backed CLI lane.
- Route agents through `fallow-runner`.
- Wrap Fallow as compact analyzer evidence.
- Normalize blocked runs into repairable JSON.
- Keep official Fallow CLI output as runtime source of truth.
- Keep CI generation outside the v1 runner.

## Owners

- Contract owner: `skills/fallow/scripts/command-contract.ts`.
- Runner owner: `skills/fallow/scripts/fallow-runner.ts`.
- Test owner: `skills/fallow/scripts/fallow-runner.test.ts`.
- Live smoke owner: `skills/fallow/scripts/fallow-runner.live.test.ts`.
- Official command owner: `https://docs.fallow.tools/llms.txt`.

## Verification

- Run `bun --cwd skills/fallow/scripts test`.
- Run runner help when changing discovery or help behavior.
- Run live compatibility smoke when Fallow is available.
