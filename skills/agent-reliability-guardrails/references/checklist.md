# Agent Reliability Checklist

## Output Contract
- [ ] JSON stdout uses a stable envelope (`status`, `schemaVersion`, `data`).
- [ ] JSON mode stdout contains no logs/human text.
- [ ] Errors are written to stderr only.

## Error Envelope
- [ ] Error payload has `code`, `action`, `retryable`, `errorFamily`.
- [ ] Includes `hintVersion`, `severity`, `recoverability`.
- [ ] Includes optional resume/retry metadata when applicable.
- [ ] Unknown errors degrade to safe fallback action (`ESCALATE`).

## Hints
- [ ] Each known code maps to a deterministic action.
- [ ] Retry delays are bounded.
- [ ] Idempotency and safe-retry semantics are explicit.

## Logging
- [ ] LogTape configured once and safely disposed.
- [ ] Categories are structured and useful.
- [ ] Redaction covers message text and structured context.
- [ ] Fingers-crossed behavior is tested (buffer then flush on error).

## Events
- [ ] Events URL is validated.
- [ ] Emission is async and non-blocking.
- [ ] Timeout and retry policy is bounded.
- [ ] Event payloads include run correlation where possible.

## Tests
- [ ] Output invariants tests pass.
- [ ] Error mapping tests pass.
- [ ] Redaction tests pass.
- [ ] Retry/event tests pass.
