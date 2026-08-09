---
name: vault-git
description: "Vault write, vault transaction, Super-vault commit, or vault-git workflow."
role: tool-workflow
---

# Vault Git

Resolve the configured Super-vault through `~/.config/context/vault.md`.

No arguments: resolve the vault, then show the available commands through the package help.

## Write Workflow

1. From `runtime/vault-git-transaction-manager`, invoke the `vault-git` package entry with `bun run --silent vault-git`; use its discovery or help for command inputs. Invocation proof: repo-root `scripts/command-entrypoint.integration.test.ts`.
2. Call `begin` with the semantic event and complete intended path set.
3. Mutate only paths admitted by the transaction.
4. Use `join` when a nested workflow needs more paths.
5. Call `complete` with a semantic summary. Never infer completion from local state; skipping the runtime's completion checks strands the lease and leaves the transaction open.
6. On any refusal, run `doctor` first, then follow the CLI's repair hint.

Use `tidy now` only for explicit hygiene. Never create a visible hygiene task; `runtime/vault-git-transaction-manager` owns its workers.

Never run raw Git against the vault; raw writes bypass single-writer fencing and corrupt transaction receipts. Fall back to the legacy direct-write procedure in `AGENTS.md` only when the CLI's JSON reports blocker `activation_blocked`. `lease_active`, `remote_unavailable`, and every other refusal is not a fallback trigger; follow the repair hint instead.

## Read Requests

Resolve the configured vault, then read it directly. Keep read-only work transaction-free.
