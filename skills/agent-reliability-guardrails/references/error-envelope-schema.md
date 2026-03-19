# Error Envelope Schema Guidance

## Minimum shape
```json
{
  "status": "error",
  "message": "sanitized user-facing message",
  "error": {
    "name": "XeroApiError",
    "code": "E_RATE_LIMITED",
    "action": "WAIT_AND_RETRY",
    "retryable": true,
    "errorFamily": "rate_limit",
    "hintVersion": 2,
    "severity": "warning",
    "recoverability": "retry",
    "exitCodeHint": 1
  }
}
```

## Recommended optional fields
- `recommendedDelayMs`
- `retryAfterMs`
- `nextCommand`
- `suggestedFallbacks`
- `safeToRetrySameInput`
- `idempotencyRisk`
- `canResume`
- `stateFile`, `checkpointId`
- `runId`
- `agentActions`
- `fingerprint`

## Rules
- Keep values machine-friendly and deterministic.
- Clamp numeric retry hints to safe ranges.
- Sanitize nested context recursively.
