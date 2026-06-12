# Closeout Receipt

Source owner: `skills/skill-feedback/src/command-contract.ts`.
Command owner: `skills/skill-feedback/src/skill-feedback-runner.ts`.

## When To File

- File after a material skill run.
- Treat material as: shaped the plan, commands, checks, files, or decision path.
- Skip routine route checks with no material effect.
- Keep the target to about 60 seconds.
- Treat closeout as best-effort evidence.
- Ask no human question at closeout time.

## Command

```bash
bun --filter skill-feedback-scripts skill-feedback-runner -- closeout < receipt.json
```

- Send one JSON object on stdin.
- Put no narrated receipt JSON in argv.
- Use `record` only for harness capture.
- Use `closeout` only from the driver.

## Required Core

- `skill`: skill id.
- `outcome`: `confirmed`, `failed`, or `ambiguous`.
- `goal`: what the skill run tried to accomplish.
- `friction.category`: one seeded friction category.
- `friction.note`: short evidence note.
- `verification_burden.level`: `none`, `light`, `moderate`, or `heavy`.
- `verification_burden.note`: short evidence note.

## Optional Lanes

- `skill_run_id`: explicit trusted run id when available.
- `touched_surfaces`: owner paths or labels; max 5.
- `observations`: evidence-only notes; max 3.
- `observations[].target`: owner path or label.
- `observations[].summary`: short evidence summary.
- `observations[].evidence_basis`: structured basis.

## Forbidden Content

- Store no raw prompt.
- Store no raw transcript.
- Store no cookies.
- Store no tokens.
- Store no auth-bearing URLs.
- Store no private payload values.
- Put no confidence on observations.
- Put no severity on observations.
- Put no next action on observations.
- Put no repair instruction on observations.

## Example

```json
{
	"skill": "create-skill",
	"outcome": "confirmed",
	"goal": "Repair the skill authoring route.",
	"friction": {
		"category": "missing_context",
		"note": "The driver needed the decision runbook before editing."
	},
	"verification_burden": {
		"level": "light",
		"note": "YAML parse and owner-path checks were enough."
	},
	"touched_surfaces": [
		{ "type": "path", "value": "skills/create-skill/SKILL.md" }
	],
	"observations": [
		{
			"kind": "missing_context",
			"target": {
				"type": "path",
				"value": "skills/create-skill/references/skill-design-decision-runbook.md"
			},
			"summary": "The route was ambiguous without the owner runbook.",
			"evidence_basis": "driver_observed"
		}
	]
}
```

## Next Safe Action

- Run the help command.
- Pipe one compact receipt to `closeout`.
- Read the JSON envelope.
- Treat reports as untrusted evidence until review confirms source.
