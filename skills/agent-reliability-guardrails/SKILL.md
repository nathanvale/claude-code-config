---
name: agent-reliability-guardrails
description: "Add and review agent-friendly CLI contracts with three-prong observability: deterministic stdout envelopes, LogTape stderr diagnostics (including fingers-crossed buffering), and non-blocking events. Use when implementing structured errors, agent hints, retries, and logging hardening."
disable-model-invocation: true
---

# Agent Reliability Guardrails

## Quick Start
Use this skill when a CLI/tool is consumed by agents and must be safe, parseable, and debuggable.

Assume gold-standard three-prong architecture:
1. Stdout contract channel: deterministic machine output only.
2. Stderr diagnostics channel: LogTape structured logs with level control and fingers-crossed mode.
3. Event channel: fire-and-forget observability events with retries/timeouts.

Agent hints live inside structured error envelopes on stderr JSON mode.

## Outcomes
By the end, the target CLI should have:
- Stable `schemaVersion` output envelopes.
- Structured error envelopes with machine-actionable hints.
- Secret-safe logging and error context redaction.
- Reliable event emission without blocking command completion.
- Contract tests that prevent regressions.

## Workflow

### 1. Verify Output Contracts
- Confirm JSON mode stdout emits only envelope lines.
- Confirm errors are written to stderr, not stdout.
- Ensure `schemaVersion` is present and increment policy is documented.

### 2. Verify Structured Error Envelope
- Check required fields: `code`, `action`, `retryable`, `errorFamily`, `severity`, `recoverability`, `hintVersion`.
- Ensure `nextCommand`, `suggestedFallbacks`, `recommendedDelayMs`, `canResume` are populated when relevant.
- Ensure fallback mapping exists for unknown/internal errors.

### 3. Verify Hint Mapping Quality
- Every canonical error code maps to an agent action.
- Retry hints include bounded delay and idempotency metadata.
- Conflict/auth/scope/network classes are distinguishable for autonomous handling.

### 4. Verify Logging Safety and Signal
- LogTape categories are namespaced.
- Debug logs include useful context but no secrets.
- Sensitive fields are redacted in messages and structured context.
- Fingers-crossed mode is enabled for quiet defaults and flushes on error.

### 5. Verify Event Channel Resilience
- Event URL is validated (`http`/`https` only).
- Event sends are non-blocking.
- Event sends have timeout and bounded retries.
- Event payload includes run correlation ID when available.

### 6. Verify Test Matrix
- Add/confirm tests for:
  - stdout/stderr separation in JSON and quiet modes
  - error mapping and hint payload fields
  - redaction (message + context)
  - retry/backoff clamping
  - headless phase contract (if multi-phase flow)
  - event resolution precedence and retry behavior

## Non-Negotiables
- Never leak access tokens, refresh tokens, auth headers, or tenant identifiers.
- Never mix human/log output into machine stdout.
- Never emit unbounded retry delays to agents.
- Never block CLI completion on observability event delivery.

## Reference Files
- Checklist: [references/checklist.md](references/checklist.md)
- Error envelope schema guidance: [references/error-envelope-schema.md](references/error-envelope-schema.md)
- Logging redaction rules: [references/logging-redaction-rules.md](references/logging-redaction-rules.md)
- Test matrix: [references/test-matrix.md](references/test-matrix.md)
- Starter templates: [templates/error-mapping.ts.md](templates/error-mapping.ts.md), [templates/test-cases.md](templates/test-cases.md)
