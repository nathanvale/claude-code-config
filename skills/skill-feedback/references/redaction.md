# Redaction

- Owner: `skills/agent-reliability-guardrails/references/logging-redaction-rules.md`.
- Runtime: `skills/skill-feedback/src/redaction.ts`.
- Apply redaction only to `NARRATED_FIELDS`: `goal`, `friction`, `explanation`.
- Leave adapter telemetry untouched: `usage`, `git_sha`, `model`, `outcome`.
- Redact bearer tokens, JWTs, PEM private keys, DSNs with inline credentials, prefix-keyed cloud tokens, auth query params, URL fragments, and non-http URL schemes.
- Do not use entropy scanning in v0.
- Count redactions in the written Software Learning Report.
- Treat `.skill-feedback/` files as transient evidence.
- Purge `.skill-feedback/` after each review session.
