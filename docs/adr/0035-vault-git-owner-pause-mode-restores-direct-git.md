---
status: accepted
date: 2026-08-16
---

# Vault Git supports an explicit host-local owner pause

Vault Git is not yet the production daily driver. An explicit human owner may pause Transaction Manager routing on one host through `${XDG_CONFIG_HOME:-$HOME/.config}/context/vault-git-paused`. The workflow skill checks the marker before any Transaction Manager command and selects bounded Direct Git Mode when present. Direct mode preserves one canonical writer, exact path commits, unrelated state, vault checks, and separate commit and push approvals.

Pause mode never deletes or rewrites receipts, capabilities, task state, activation evidence, or Remote Ledger evidence. It may begin only after inspection rules out an active worker and unknown publication. Each host is paused independently. Re-enabling requires explicit owner direction plus reconciliation of direct Git state, preserved transaction evidence, and the Remote Ledger; marker removal is the final selection change.

An automatic fallback, missing executable, activation revocation, or arbitrary runtime refusal never selects Direct Git Mode. This keeps the escape hatch deliberate while allowing ordinary vault work to continue before Transaction Manager reaches daily-driver quality.
