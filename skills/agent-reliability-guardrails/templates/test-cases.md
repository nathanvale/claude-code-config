# Template: Contract Test Cases

## Output invariants
1. `--json` success: stdout has exactly one parseable JSON envelope line.
2. `--json` error: stdout is empty, stderr has error envelope.
3. `--quiet` success: stderr is empty.

## Error/hint mapping
1. `E_SCOPE_RESTRICTED` maps to browser fallback action.
2. `E_RATE_LIMITED` includes bounded `recommendedDelayMs`.
3. Unknown code maps to fallback `ESCALATE`.

## Redaction
1. Authorization header is redacted.
2. Token-like query params are redacted.
3. Nested context fields with sensitive keys are redacted.

## Events
1. Invalid `events-url` is ignored/rejected.
2. First send failure retries once.
3. Event path does not alter command exit behavior.
