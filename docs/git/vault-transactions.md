# Vault Transactions

## Purpose

- Route every configured Super-vault write through `vault-git`.
- Enforce one fenced writer across laptop and Mac Mini clones.
- Commit only transaction-owned paths.
- Keep capabilities, receipts, recovery proofs, and activation admission private under XDG state.
- Publish main plus lease release through one atomic remote close.

Runtime owner: `runtime/vault-git-transaction-manager/`.

Workflow owner: `skills/vault-git/SKILL.md`.

Command contract owner: `runtime/vault-git-transaction-manager/src/command-contract.ts`.

## Agent Route

1. Invoke the `vault-git` skill.
2. Use command discovery for current inputs.
3. Begin with the semantic event and complete owned-path set.
4. Change only admitted paths.
5. Join extra paths through the active transaction.
6. Complete with a semantic summary.
7. Treat the returned lifecycle result as authority. Never infer closure from local Git state.

Keep read-only vault access outside a transaction.

Never use raw Git for vault writes. Raw Git bypasses fencing and private recovery evidence.

## Lifecycle

```text
activation admission
  -> intent receipt
  -> remote lease CAS
  -> writing
  -> vault-owned check
  -> exact owned-path commit
  -> atomic main + release-ledger push
  -> closed receipt
```

- Use the remote CAS ledger generation as the writer fence.
- Preserve staged, unstaged, and untracked state outside owned paths.
- Stop on remote main movement or ledger movement.
- Replay only through the named continuation after fresh evidence.
- Leave no partial remote success classified as retryable.

Lifecycle owner: `runtime/vault-git-transaction-manager/src/engine.ts`.

Remote fence owner: `runtime/vault-git-transaction-manager/src/remote-ledger.ts`.

Git boundary owner: `runtime/vault-git-transaction-manager/src/git-adapter.ts`.

Private receipt owner: `runtime/vault-git-transaction-manager/src/store.ts`.

## Recovery

1. Run `doctor` after interruption, timeout, unknown push outcome, or refusal.
2. Read the finding, blocker, retry safety, and named repair action.
3. Run only the named `repair` action.
4. Re-run `doctor` after any new ambiguity.
5. Hand off when the continuation requests operator review.

- Use `close-verified` only after doctor proves both published refs and transaction payloads.
- Use `resume` only after doctor revalidates the durable phase and remote fence.
- Never retry an unknown push directly.
- Never rebase, merge, force push, or reset as recovery.

Diagnosis owner: `runtime/vault-git-transaction-manager/src/doctor.ts`.

Repair owner: `runtime/vault-git-transaction-manager/src/repair.ts`.

## Activation Gate

Keep live activation off until the operator completes both admissions.

### Vault state admission

- Reconcile the vault's locally-ahead `main`.
- Restore access to the intended remote.
- Compare local main, remote main, and the transaction ledger.
- Preserve any local-only work before reconciliation.
- Record the host-owned rollout receipt.
- Admit activation through the runtime owner only after reconciliation passes.

Unadmitted writes return blocker `activation_blocked`. The `vault-git` skill owns the bounded legacy fallback for that blocker only.

Activation record owner: `runtime/vault-git-transaction-manager/src/store.ts`.

### Per-host Git identity admission

- Use one dedicated repository-scoped SSH identity per writer host.
- Keep `known_hosts` owner-only and reviewed.
- Use batch mode.
- Require strict host-key checking.
- Use identities-only selection.
- Disable trust-on-first-use.
- Disable ambient SSH, agent, credential-helper, URL rewrite, and identity fallback.
- Review the effective repository and SSH configuration before admission.
- Admit laptop and Mac Mini independently.

Keep activation off when either host identity is absent, ambiguous, or unreviewed.

Host admission and rollout receipt owner: operator rollout procedure. Runtime code does not create host trust.

## Evidence

- Hermetic process acceptance: `runtime/vault-git-transaction-manager/tests/live-acceptance.integration.test.ts`.
- Repeated two-clone fencing: `runtime/vault-git-transaction-manager/tests/two-clone-race.integration.test.ts`.
- Atomic close: `runtime/vault-git-transaction-manager/tests/atomic-close.integration.test.ts`.
- Deterministic recovery: `runtime/vault-git-transaction-manager/tests/repair.integration.test.ts`.
- Intended-host proof and rollout receipt: host-owned U9 evidence.
