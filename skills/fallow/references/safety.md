# Fallow Safety

## Apply Policy

- Treat evidence commands as read-only.
- Treat `fix-preview` as write inspection, not source mutation.
- Treat `fix-apply` as the only mutation boundary.
- Run `fix-apply` only after current-task user authorization.
- Do not infer apply permission from auto-fixable findings.

## Config Trust

- Inspect reported config paths before mutation.
- Treat config presence and paths as scope evidence, not a blocker by itself.
- Let Fallow own config semantics.
- Do not parse or judge Fallow config contents in the runner.

## Excluded Behavior

- Do not auto-install Fallow.
- Do not enable telemetry.
- Do not run watch mode.
- Do not create or update baselines.
- Do not generate CI workflows.
- Do not invoke other skills from the runner.
- Use runner help for accepted public inputs.
- Treat unsupported control errors as usage failures.

## Mutation Checks

- Confirm current-task user authorization.
- Confirm the target repo root.
- Review config-scope metadata.
- Prefer preview before apply.
- Rerun evidence after apply.
- Preserve unrelated user changes.

## Secret Safety

- Do not print tokens, cookies, credentials, or auth-bearing URLs from Fallow output.
- Report setup and config checks by presence, categories, and paths only.
