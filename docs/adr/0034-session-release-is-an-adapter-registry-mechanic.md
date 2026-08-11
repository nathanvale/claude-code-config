---
status: accepted
date: 2026-08-11
---

# Session release is an adapter registry mechanic

Session release belongs to the browser-connect `AdapterDefinition` registry as
the per-adapter `releaseSession` mechanic. Browser Connect owns adapter-native
release argv; Browser Use resolves the registered mechanic by adapter id.

This extends ADR-0031's delegation boundary to session release specifically.
Browser Use owns the Adapter Session Lease and decides when the run-owned
session reaches its terminal seam. It does not encode adapter session mechanics
such as agent-browser `close` or Playwright CLI `detach`.

The registry keeps release beside `checkProvenance`, `inject`, and
`probeAttachment`. Each adapter implements its own semantics: agent-browser
closes one named session without `--cdp`; playwright-cdp detaches its named
session without closing Agent Chrome.

## Considered Options

- Keep a loose standalone release export: rejected because it bypasses the
  registry and creates the first browser-action surface in an attachment-only
  runtime.
- Let Browser Use encode adapter-specific close or detach argv: rejected
  because it violates ADR-0031's rule that Browser Use must not encode adapter
  session mechanics.
- Add `releaseSession` to the AdapterDefinition registry: chosen because release
  remains per-adapter, behind the existing browser-connect seam, and consumers
  resolve it by adapter id.

## Consequences

- Browser Connect owns release argv and per-adapter release semantics (KTD3).
- Browser Use owns session lifetime policy but never imports or reproduces
  close or detach argv.
- Agent-browser release verifies absence with bounded session-inventory
  re-reads. Release settles asynchronously, so a successful close envelope or
  one immediate inventory read is insufficient; the live spike proved the
  bounded re-read necessary.
- Adapter Session Lease vocabulary remains distinct from authentication
  authority and env/profile run leases (KTD6).
