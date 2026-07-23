---
status: accepted
date: 2026-07-22
---

# Only disposable retrieval and delivery helpers may see browser secrets

Browser Use limits the raw-secret trusted computing base to two disposable processes:

- The official `op` helper receives `OP_SERVICE_ACCOUNT_TOKEN`, retrieves one exact field, and writes it to a private inherited pipe. It is a short-lived trusted networked process. Browser Use does not pass it the verified browser endpoint or channel and does not claim 1Password-domain-only network confinement.
- A signed App Sandbox XPC Confidential Field Delivery Helper reads that one value and writes it to one pre-proven field through a transferred pre-opened browser-channel descriptor. It receives no OP token, network entitlement, or broad file entitlement.

Task adapters, adapter plugins and daemons, long-lived Browser Use processes, the approval broker, agents, and public CLIs never receive raw username, password, or OTP bytes. The selected task adapter remains attached, pauses observation during delivery, invalidates stale local handles, then resumes after cleanup and Session Identity Proof.

Tmux and persistent PTYs are excluded from unattended authentication. They may preserve interactive 1Password desktop-app sign-in state only. Direct service-account reads use a signed exact-environment launcher to read the one token from its private data-protection Keychain access group, then immediately `exec` the disposable 1Password helper; neither the token nor raw field values enter a tmux server, pane, capture buffer, or shell history.

## Pressure Gate

- Pressure: Agent Browser, Playwright CLI, Chrome DevTools CLI, and Chrome DevTools MCP may all encounter authentication, but their native secret paths expose values to adapter processes.
- Seam: one transaction-internal Confidential Field Delivery Helper operates against the already-proven target.
- Deletion test: removing it either duplicates raw-secret handling across four task lanes or removes unattended login.
- Leverage: one containment, origin, cleanup, and sentinel-leak suite governs every lane.

## Considered Options

- Include the selected adapter in the trusted computing base: simpler native integration, but multiplies secret-bearing processes and admits long-lived plugin/daemon memory.
- Disable unattended credentials entirely: safest fallback when helper containment fails, but not the intended capability.

## Consequences

- Agent Browser provider deserialization, Playwright symbolic-secret daemon materialization, Chrome CLI positional fill, and Chrome MCP JSON fill are inadmissible for secrets.
- Fresh unattended login remains unsupported until helper containment and lane-specific pause/resume continuity pass live conformance.
- Browser Connect remains connection-only; the helper consumes a pre-opened verified channel and does not become an adapter.
- The canonical One Password skill must distinguish interactive persistent-shell work from direct service-account reads; its former tmux-for-every-command rule cannot govern Browser Use unattended auth.
- Delivery confinement uses supported App Sandbox, code-signing, entitlement, XPC lifecycle, and file-descriptor APIs. A live probe must prove the service can use transferred connected descriptors without gaining permission to open new connections or unrelated files.
- The official `op` helper remains deliberately trusted; a stronger 1Password-domain-only network boundary would require a separate architecture decision.
- Failure to prove OS containment keeps session reuse and user presence available without widening the trusted computing base.
