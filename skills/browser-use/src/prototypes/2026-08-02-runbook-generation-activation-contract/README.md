# Runbook Generation activation contract (throwaway logic spike)

Can the source-to-runtime model (ADR 0031) do committed provenance, whole-catalog
digest review, immutable staging, atomic activation, bootstrap cutover, and
post-cutover no-fallback with one authoring source?

Run:

```text
cd skills/browser-use
bun run prototype:runbook-generation-activation
```

Uses a scratch temp generation store (created + cleaned up by the run). Verdict
and full transcript: `findings.md`. No tests.
