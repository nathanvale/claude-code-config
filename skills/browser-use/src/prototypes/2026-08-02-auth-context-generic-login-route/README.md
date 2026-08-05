# auth-context generic-login route (throwaway spike)

Pre-build falsification: does a Runbook carrying only `auth_context_ref` enter
the existing generic login engine, preserve run identity, and dispatch the first
business step only after auth succeeds?

Run:

```text
cd skills/browser-use
bun run prototype:auth-context-generic-login-route
```

Verdict and exact call sequence: `findings.md`. Agent Chrome route only.
