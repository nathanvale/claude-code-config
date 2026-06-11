# Report Shape

Source owner: `skills/skill-feedback/src/command-contract.ts`.

## Truth Stance

- This report is evidence.
- This report is not canonical skill instruction.
- Narrated text is untrusted.
- `untrusted_evidence: true` marks every record.
- Repair source through the owning skill, runtime, or plan.
- Do not store raw transcripts, prompts, cookies, tokens, or auth-bearing URLs.

## Template

- `evaluation_name`: `skill-feedback`.
- `untrusted_evidence`: `true`.
- `generated_ts`: caller-supplied ISO timestamp.
- `skill`: skill identity.
- `skill_version`: engine-read skill version.
- `git_sha`: engine-read repository revision.
- `model`: adapter-read model identity.
- `outcome`: `confirmed`, `failed`, or `ambiguous`.
- `goal`: redaction-gated narrated goal.
- `friction`: redaction-gated narrated friction.
- `explanation`: optional redaction-gated narrated explanation.
- `usage`: adapter-read token usage.
- `degraded`: missing required evidence marker.
- `gaps`: missing required fields.
- `redactions`: narrated-field redaction count.

## Reading Rule

- Use reports to find candidate improvements.
- Confirm every proposed instruction change against local source evidence.
- Delete reports after the review session.
