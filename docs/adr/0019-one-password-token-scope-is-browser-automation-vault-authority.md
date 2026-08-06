---
status: accepted
date: 2026-07-21
---

# 1Password token scope is the Browser Automation vault authority

Browser Use requires `OP_SERVICE_ACCOUNT_TOKEN` to expose exactly one dedicated Browser Automation vault. The token's effective 1Password grant is the vault authority; Browser Use stores item Auth Pointers and observed vault identity but no parallel vault allowlist. Zero or multiple visible vaults fail with a scope-repair continuation.

## Considered Options

- Cache a vault choice when several are visible: flexible, but creates a second durable security decision.
- Intersect token access with a Browser Use YAML allowlist: defence in depth, but duplicates 1Password permissions and creates bootstrap drift.

## Consequences

- 1Password remains the sole vault-access owner.
- Service-account provisioning grants one vault only.
- Expanding token scope intentionally stops Browser Use until the scope returns to exactly one vault.
