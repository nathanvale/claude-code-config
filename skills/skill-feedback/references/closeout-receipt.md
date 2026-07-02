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
bun run skills/skill-feedback/src/skill-feedback-runner.ts closeout < receipt.json
```

- Send one JSON object on stdin.
- Use the direct runner for closeout stdin.
- Keep filtered package scripts for help and non-stdin commands.
- Put no narrated receipt JSON in argv.
- Use `record` only for harness capture.
- Use `closeout` only from the driver.

## Required Core

- `skill`: skill id.
- `outcome`: `confirmed`, `failed`, or `ambiguous`.
- `goal`: what the skill run tried to accomplish.
- `friction.category`: `none`, `missing_context`, `unclear_ownership`, `tool_failure`, `verification_tax`, `bad_guidance`, `scope_mismatch`, or `other`.
- `friction.note`: short evidence note.
- `verification_burden.level`: `none`, `light`, `moderate`, or `heavy`.
- `verification_burden.note`: short evidence note.

## Optional Lanes

- `touched_surfaces`: owner paths or labels; max 5.
- `observations`: evidence-only notes; max 3.
- `observations[].kind`: `friction`, `verification_gap`, `missing_context`, `ownership_gap`, `tool_failure`, `bad_guidance`, `scope_mismatch`, `runtime_signal`, `product_signal`, or `other`.
- `observations[].target`: owner path or label.
- `observations[].summary`: short evidence summary.
- `observations[].evidence_basis`: `driver_observed`, `verification_step`, `tool_result`, `missing_source`, or `other`.

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
- Put no `skill_run_id` in the receipt.
- Put no `skill_run_id_provenance` in the receipt.
- Put no `witness_id` in the receipt.
- Put no trust, proof, or correlation fields in the receipt.

## Trust Boundary

- The writer may attach `writer_proof` after validation.
- The receipt cannot self-assert proof, run identity, or correlation.
- Driver closeout remains evidence.
- A separate signed witness may link closeout to a runtime-owned Claude Stop hook report.
- Review creates `correlation_owned` only after witness verification succeeds.
- Review checks the witness, linked report proofs, skill match, writer key, and hook runtime run id.
- Correlate repair may write a missing private witness after preview and current-evidence validation.
- Receipt evidence alone does not create `corroborated`.

## Example

```json
{
	"skill": "skill-author",
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
		{ "type": "path", "value": "skills/skill-author/SKILL.md" }
	],
	"observations": [
		{
			"kind": "missing_context",
			"target": {
				"type": "path",
				"value": "skills/skill-author/references/skill-design-decision-runbook.md"
			},
			"summary": "The route was ambiguous without the owner runbook.",
			"evidence_basis": "driver_observed"
		}
	]
}
```

## Next Safe Action

- Run the help command.
- Pipe one compact receipt through the direct runner.
- Read the JSON envelope.
- Treat reports as untrusted evidence until review confirms source.
