# Fallow Workflows

## Self-Review

- Finish the implementation slice first.
- Run `doctor` if readiness is unknown.
- Choose one evidence command that matches the risk.
- Use command help when exact syntax matters.
- Fix or flag findings using local judgment and project rules.
- Rerun the same evidence command.
- Report before/after summary when evidence changed.

## Cleanup Pass

- Start with full-repo evidence before PR-only audit on a dirty baseline.
- Run `dead-code` for removal candidates.
- Run `dupes` for clone families and repeated blocks.
- Run `health` for complexity and coupling pressure.
- Keep per-finding refactor plans outside the runner.
- Use architecture or review skills only when the user asks for that broader workflow.

## Changed-Code Audit

- Use `audit` after implementation or before review.
- Provide an explicit base only when the task or branch context needs it.
- Treat inherited baseline work as separate cleanup unless the current task owns it.

## Preview And Apply

- Run `fix-preview` before source mutation.
- Inspect the preview and config-scope signals.
- Ask for current-task user authorization before `fix-apply` unless the user already authorized apply in this task.
- Run `fix-apply` only through the explicit apply subcommand.
- Rerun the prior evidence command after apply.

## Blocked Runs

- Read the failure category.
- Follow the first safe repair hint.
- Run `doctor` when setup cause is unclear.
- Retry the same input only when the hint says retry is safe.
- Keep per-finding repair plans outside blocked runner recovery.

## Stop

- Stop when the runner cannot produce usable evidence and no repair hint applies.
- Stop before `fix-apply` when current-task user authorization is missing.
- Stop before broad refactors that exceed the current task.
