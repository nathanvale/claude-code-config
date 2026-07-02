# Provenance

- Source plan: `skills/skill-feedback/docs/plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md`.
- v1 source plan: `skills/skill-feedback/docs/plans/2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md`.
- Correlation witness plan: `skills/skill-feedback/docs/plans/2026-06-25-001-feat-skill-feedback-correlation-witnesses-plan.md`.
- Source brainstorm: `skills/skill-feedback/docs/brainstorms/2026-06-10-skill-follow-up-feedback-loop-requirements.md`.
- Hook decision: `docs/adr/0014-skill-feedback-fires-on-harness-hooks-not-agent-recall.md`.
- Package anatomy: `skills/fallow/`.
- Facade lane: `skills/cli-author/references/cli-command-facade.md`.
- Truth stance pattern: `skills/skill-self-audit-loop/SKILL.md`.
- Redaction owner: `skills/agent-reliability-guardrails/references/logging-redaction-rules.md`.
- Storage routing owner: `skills/context-advisor/references/storage-routing.md`.

## Notes

- v0 writes evidence-only reports under `.skill-feedback/`.
- v0 rejects unknown receipt fields.
- v0 keeps engine-read telemetry out of public flags.
- v1 keeps `record` capture-owned.
- v1 lets the driver submit closeout evidence through stdin.
- v1 keeps human review after closeout.
- Correlation witnesses are private hook/runtime artifacts, not public closeout input.
- U8 owns harness hook wiring.
