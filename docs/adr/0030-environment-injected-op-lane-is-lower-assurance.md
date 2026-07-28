---
status: accepted
date: 2026-07-28
---

# Environment-Injected OP Lane is a lower-assurance deployment path

Browser Use supports an Environment-Injected OP Lane when the signed Browser Use Security capability is absent and service-account authority is present in the process launch environment. This lane makes read-only vault login automation portable to the headless Mac Mini, but never counts as signed native admission; the signed lane remains preferred and ADR 0021 and ADR 0022 remain authoritative for its custody guarantees.

The lower-assurance lane preserves the two-disposable-process raw-secret boundary: the official `op` process retrieves one field, passes its value through a private pipe to an unsigned disposable delivery process, and neither the main TypeScript process nor the selected Browser Adapter receives the value. It deliberately gives up signed process identity, App Sandbox confinement, private Keychain token custody, and the signed lane's live assurance tiers.

## Considered Options

- Keep unattended credential delivery signed-only: strongest assurance, but leaves vault logins unavailable on the chosen headless deployment.
- Return raw values through TypeScript and the selected Browser Adapter: smallest implementation, but expands the raw-secret trusted computing base into long-lived processes.
- Replace the signed architecture: reduces lane count, but silently weakens deployments that can satisfy native admission.

## Consequences

- Runtime and ledger evidence identify this lane as lower assurance; they never report signed native capability.
- Lane selection is three-state: an admitted signed product wins; `native-capability-absent` may select the Environment-Injected OP Lane; a present but non-admitted product or failed admission probe blocks rather than masking drift with fallback.
- The service-account token is a bearer secret exposed to compromise of the launch environment or same-user process boundary. One dedicated read-only vault is the damage boundary; rotation on device move and revocation on theft are required operator responses.
- Theft response must work from another trusted device while the Mac Mini is offline. The ordered kill sequence revokes the 1Password service-account token, removes the Mini from the Tailscale tailnet, marks it lost or queues erase through Find My, then rotates adjacent host credentials. Deleting the local token file is cleanup, never the emergency control.
- Browser Use owns token lifecycle, lane admission, status, and delivery. The dotfiles repository owns the host-wide off-host theft runbook, prerequisite checks, non-destructive rehearsal, and post-reboot health check. Emergency controls stay manual and off-host; the design adds no stored 1Password, Tailscale, or Apple administrative credential.
- Automatic post-reboot readiness uses one dedicated permission-restricted token file outside the repository. A narrow launch wrapper reads only that file; the token never enters shell profiles, shared `.env` files, shell history, or persistent PTY state.
- The token file lives under Browser Use's admitted configuration root. Every ancestor is owner-only; the token is one owner-matched regular file at mode `0600`, never a symlink or hard link, and is excluded from sync and backup. Unsafe shape, owner, mode, or ancestry blocks before token use.
- Browser Use owns the versioned, tested wrapper and fixed token-file contract. Setup installs only non-secret machinery; per-host token provisioning remains an explicit operator action. The wrapper is demand-started, not a daemon.
- Browser Use also owns explicit token install and remove commands. Installation accepts the token through either a hidden interactive prompt or explicit standard input for encrypted remote provisioning; token arguments and ordinary environment flags are rejected. It validates without disclosure and atomically creates the fixed permission-restricted file. Removal targets only that exact file and never reveals its contents.
- Replacement validates a staged token before atomically replacing the prior file; failure preserves the prior working token. Local removal never claims remote revocation and emits that next action when custody is being retired or the host is lost.
- `browser-use auth status --json` is the secret-free post-reboot admission check. It reports the selected lane, token-file safety, `op` and token validity, exactly-one-vault scope, credential-clean profile policy, and one repair action without retrieving a credential field.
- The same deployment contract runs first on the MacBook Pro and then on the Mac Mini. Each host is provisioned separately; cutover rotates the token with at most one hour of overlap, proves the Mac Mini, then immediately revokes the old token and removes the MacBook copy. Hardware-model equality never implies shared custody.
- Browser Use probes token presence without copying its value into TypeScript runtime state. An external exact-environment wrapper transfers the inherited token to `op`; the parent process boundary remains an explicit lower-assurance exposure.
- Every Browser Use child environment excludes `OP_SERVICE_ACCOUNT_TOKEN` except the exact `op` retrieval child. Adapter, browser, helper, setup, and diagnostic children never inherit it.
- Item binding may proceed only from deterministic unique live vault evidence. Ambiguity blocks delivery until an operator repairs the vault or binding; the unsigned lane cannot mint or persist selection authority.
- Vault writes remain outside this lane. Browser field delivery and login submission are not vault writes.
- Lane admission requires a credential-clean dedicated Agent Chrome profile with browser password saving, credential autofill, and sync disabled through profile-owned preferences and launch controls. `auth status` verifies those controls. Existing saved credentials, an unproven state, or a credential-save prompt blocks confidential delivery. The lane never changes system-wide policy or everyday Chrome.
- An unsafe Agent Chrome profile is never scrubbed in place. Repair fails closed and offers creation of a fresh dedicated profile only after explicit operator approval; the prior profile remains recoverable until a separate, explicitly approved removal.
- Each lazy credential handle is short-lived, single-use, field-bound, item-bound, target-bound, and consumed atomically by one helper action. Expiry, replay, target drift, helper interruption, or an outcome that may have written blocks; Browser Use never retries that field automatically.
- The lane reuses Browser Use's secret-free sensitive-run marker, governed-output release gate, and leak harness. Operational capture quarantine, repair sweeps, and native isolation remain outside this lane.
- Deployment proof requires `auth status` plus one controlled Oncore password-login run on the MacBook Pro, then the same checks after an actual Mac Mini reboot and cutover. No broader portal rollout occurs before both proofs pass.
- Installing an admitted signed capability changes selection back to the signed lane without deleting this deployment option.
