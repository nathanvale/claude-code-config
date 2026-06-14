# Redaction

- Owner: `skills/agent-reliability-guardrails/references/logging-redaction-rules.md`.
- Runtime: `skills/skill-feedback/src/redaction.ts`.
- Apply v0 redaction to `NARRATED_FIELDS`: `goal`, `friction`, `explanation`.
- Apply v0 redaction to top-level `model` because public stdin telemetry can carry arbitrary strings.
- Apply v1 redaction to `AGENT_AUTHORED_STRING_PATHS`.
- Redact closeout goal, friction note, verification note, touched-surface values, observation target values, and observation summaries.
- Leave trusted runtime telemetry untouched except the public v0 `model` string: `usage`, `git_sha`, `outcome`, `skill_version`.
- Redact bearer tokens, JWTs, PEM private keys, DSNs with inline credentials, prefix-keyed cloud tokens, auth query params, URL fragments, and non-http URL schemes.
- Do not use entropy scanning in v1.
- Count v0 redactions in the written Software Learning Report.
- Count v1 redactions in the closeout command result.
- Treat `.skill-feedback/` files as transient evidence.
- Keep review mutation-free.
- Emit retention warnings at 14 days or 100 reports.
- Run purge as a separate explicit mutation workflow.
