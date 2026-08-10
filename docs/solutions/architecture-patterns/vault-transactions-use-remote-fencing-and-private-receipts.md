---
title: "Vault Transactions Use Remote Fencing and Private Receipts"
date: "2026-08-10"
last_updated: "2026-08-10"
category: "architecture-patterns"
module: "vault-git-transaction-manager"
problem_type: "architecture_pattern"
component: "transaction_manager"
severity: "high"
applies_when:
  - "Two or more hosts can write one canonical Git-backed vault"
  - "Unrelated staged, unstaged, and untracked work must survive a bounded commit"
  - "A push timeout or process interruption can leave publication outcome unknown"
related_components:
  - "git"
  - "recovery"
  - "agent-workflows"
tags:
  - "vault-git"
  - "remote-fencing"
  - "compare-and-swap"
  - "private-receipts"
  - "atomic-push"
  - "crash-recovery"
  - "admission-gate"
---

# Vault Transactions Use Remote Fencing and Private Receipts

## Context

A shared Git-backed vault has two independent failure surfaces:

- Multiple hosts can observe the same main head and begin writing concurrently.
- One host can crash after local preparation or remote publication but before recording acknowledgement.

Local locks solve neither case. A laptop lock cannot fence a Mac Mini. A successful local commit cannot prove whether an interrupted remote push landed. Broad staging also risks absorbing unrelated user state.

The transaction manager now proves this boundary through real Bun CLI processes, disposable clones, a bare remote, durable XDG state, process interruption, and remote fault injection.

## Solved Pattern

### Use the remote ledger generation as the fence

`runtime/vault-git-transaction-manager/src/remote-ledger.ts` observes one exact ledger generation and acquires the lease through compare-and-swap. Concurrent clones race on the same generation. One advances it. The loser receives a remote-movement refusal.

The ledger records public transaction coordination only. It carries the transaction id, actor and host labels, event, owned paths, baseline heads, lease timing, and lease state.

### Keep authority and recovery evidence private

`runtime/vault-git-transaction-manager/src/store.ts` keeps receipts, role capabilities, doctor proofs, quarantine markers, checker admission, and activation admission in owner-only XDG state.

The remote ledger never carries capability bytes or private filesystem paths. CLI output carries bounded correlation and next actions, not authority material.

### Commit exact owned paths

`runtime/vault-git-transaction-manager/src/git-adapter.ts` snapshots unrelated index and worktree state at admission. Completion builds a private index from the admitted baseline, freezes only owned literal paths, proves the candidate tree, creates one single-parent commit, then updates the canonical owned entries.

Staged, unstaged, and untracked state outside the owned set remains byte-identical across success, refusal, and recovery acceptance cases.

### Close main and the lease atomically

Completion prepares the exact event commit and release-ledger commit, persists both expected object ids, then pushes both full refs with atomic transport and exact old-object leases.

Remote reconciliation classifies only three proven shapes:

- Both expected objects landed: closed.
- Both refs stayed at admitted generations: unchanged and eligible for bounded recovery.
- Only one side or conflicting ancestry landed: host contract breach and operator handoff.

Unknown transport evidence remains unknown. It never becomes an automatic retry.

### Make doctor and repair deterministic

`runtime/vault-git-transaction-manager/src/doctor.ts` reconciles receipt phase, local main, remote main, ledger generation, prepared commits, host identity, and quarantine state.

`runtime/vault-git-transaction-manager/src/repair.ts` accepts only the action named by fresh doctor evidence. Lost acknowledgement closes through `close-verified`. Interrupted admitted phases resume through `resume`. Partial remote state has no retry action.

### Gate activation and Janitor admission

`runtime/vault-git-transaction-manager/src/engine.ts` refuses write commands until the private activation admission exists. `runtime/vault-git-transaction-manager/src/janitor.ts` uses the same gate plus checker admission and clean-tree preflight.

This keeps unattended hygiene behind the same operator decision as foreground writes. It does not create host trust or reconcile a locally-ahead vault.

## Evidence

- `runtime/vault-git-transaction-manager/tests/live-acceptance.integration.test.ts`: real CLI lifecycle, two-clone race, stale refusal, remote movement, failed and lost-ack push, killed-process recovery, profile parity, hostile environment, atomic capability refusal, partial remote state, activation blocking, unrelated-state preservation.
- `runtime/vault-git-transaction-manager/tests/two-clone-race.integration.test.ts`: repeated real-Git lease races with one winner and one fenced writer.
- `runtime/vault-git-transaction-manager/tests/atomic-close.integration.test.ts`: two-ref atomic close, exact leases, movement refusal, and one-ref breach classification.
- `runtime/vault-git-transaction-manager/tests/repair.integration.test.ts`: deterministic doctor and repair decisions from durable evidence.
- `runtime/vault-git-transaction-manager/tests/vault-git.integration.test.ts`: catalog-driven real-process command contract and activation behavior.

## Apply When

Use this lifecycle when independent hosts write one canonical Git branch, exact path ownership matters, and remote acknowledgement can be lost.

Keep a simpler workflow for one-process repositories where an interrupted push is externally idempotent and unrelated working state cannot be captured.

## Operator Route

Use `skills/vault-git/SKILL.md` for writes and recovery. Use `docs/git/vault-transactions.md` for activation and host-admission constraints.
