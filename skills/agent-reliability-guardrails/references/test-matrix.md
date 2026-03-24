# Test Matrix

## Output contracts
- JSON success writes one envelope line to stdout.
- JSON errors write to stderr only.
- Quiet mode has no noisy stderr on success.

## Error and hints
- Known codes map to expected action + family.
- Unknown code falls back to `ESCALATE`.
- Delay hints are clamped.
- Resume metadata is inferred when checkpoint context exists.

## Logging
- Setup/shutdown is idempotent.
- Stream-close errors during disposal are tolerated.
- Sensitive values are redacted in both message/context.

## Events
- Config precedence: disable flag > explicit flag > env > autodiscovery.
- Invalid URL schemes are rejected.
- Event emit retries once or as configured.
- Event send never blocks command return path.
