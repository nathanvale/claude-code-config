# Logging and Redaction Rules

## Always redact
- Access/refresh tokens
- Bearer and Authorization headers
- Client secrets and API keys
- Session/cookie credentials
- Tenant identifiers if they can identify customer data

## Apply redaction to
- Free-text error messages
- Structured error context payloads
- Structured debug log fields
- Event payloads if they can carry secrets

## Implementation notes
- Use both key-based and pattern-based redaction.
- Redact recursively in objects/arrays.
- Cap traversal depth to prevent runaway recursion.
- Test redaction with representative payload fixtures.
