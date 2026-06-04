# Fallow Runner CLI Design Brief

Lane: Facade-backed CLI.

## Name

- Use `fallow-runner`.

## Purpose

- Run Fallow as compact, parseable analyzer evidence for agents.
- Normalize blocked runs into repairable JSON.

## Users

- Serve agents first.
- Keep humans and scripts usable.

## Usage

- Use one executable with v1 subcommands.
- Target the repo through the runner root input.
- Default root to the current directory.
- Accept audit base input only on audit.
- Omit raw Fallow output unless explicitly requested.
- Apply a public output budget.

## Help

- Render root and subcommand help through the facade-backed path.
- Make `-h` and `--help` show help without running Fallow.
- Advertise accepted public inputs only.
- Reject unsupported public-looking controls.

## I/O

- Emit the primary JSON envelope to stdout.
- Emit diagnostics, setup notes, and expected runtime errors to stderr.
- Support JSON output only in v1.

## Errors

- Classify blocked runs coarsely.
- Include one small repair hint when a safe next action is known.
- Keep retry safety explicit.

## Side Effects

- Keep evidence modes read-only.
- Keep `doctor` read-only.
- Map fix preview to dry-run behavior.
- Map fix apply to explicit apply behavior.

## Safety

- Do not auto-install Fallow.
- Do not configure telemetry.
- Do not run watch mode.
- Do not own baselines.
- Do not generate CI workflows.
- Do not invoke other skills.

## Config

- Report config presence and paths.
- Do not parse Fallow config semantics.
- Label evidence as config-scoped when config files are present.

## Owners

- Contract owner: `skills/fallow/scripts/command-contract.ts`.
- Model owner: `skills/fallow/scripts/fallow-runner.ts`.
- Engine owner: `skills/fallow/scripts/fallow-runner.ts`.
- Discovery owner: `skills/fallow/scripts/fallow-runner.ts`.
- CLI owner: `skills/fallow/scripts/fallow-runner.ts`.
- Test owner: `skills/fallow/scripts/fallow-runner.test.ts`.
- Live smoke owner: `skills/fallow/scripts/fallow-runner.live.test.ts`.

## Proof

- Validate the facade contract at construction.
- Prove discovery metadata, rendered help, parser acceptance, parser rejection, and runtime semantics against one surface.
- Run live compatibility smoke when Fallow is available.
