# Browser Authentication U0 Fixture

Research-only process and browser fixture for Auth Plan U0.

## Scope

- Build one ad hoc-signed App Sandbox XPC bundle.
- Attempt embedded XPC service admission.
- Fall back only inside the fixture to inherited descriptors so independent
  origin, sandbox, replay, ordering, and cleanup probes can finish.
- Generate one mock sentinel inside the disposable retrieval helper.
- Emit redacted JSON only.
- Leave production Browser Use and secret-delivery code untouched.

The inherited-descriptor fallback is evidence gathering, not an accepted
delivery transport.

## Run

```bash
bun test skills/browser-use/src/browser-auth-u0-research.test.ts
```

Controlled Agent Browser continuity requires a verified handoff:

```bash
browser-connect connect agent-browser --json \
  --run-id auth-u0-agent-browser-continuity > /tmp/auth-u0-handoff.json

bun skills/browser-use/src/fixtures/browser-auth-u0/agent-browser-continuity.ts \
  /tmp/auth-u0-handoff.json
```

## Evidence

See
`skills/browser-use/docs/research/2026-07-23-browser-auth-u0-evidence-receipt.md`.
