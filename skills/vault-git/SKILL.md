---
name: vault-git
description: "Vault write, vault transaction, Super-vault commit, or vault-git workflow."
role: tool-workflow
---

# Vault Git

Resolve the configured Super-vault through `~/.config/context/vault.md`.

## Write Workflow

1. From `runtime/vault-git-transaction-manager`, invoke the `vault-git` package entry with `bun run --silent vault-git`; use its discovery or help for command inputs. Invocation proof: `scripts/command-entrypoint.integration.test.ts`.
2. Call `begin` with the semantic event and complete intended path set.
3. Mutate only paths admitted by the transaction.
4. Use `join` when a nested workflow needs more paths.
5. Call `complete` with a semantic summary. Never infer completion from local state.
6. On any refusal, run `doctor` first, then follow the CLI's repair hint.

Use `tidy now` only for explicit hygiene. Never create a visible hygiene task; `runtime/vault-git-transaction-manager` owns its workers.

Never run raw Git against the vault. Only when the CLI reports activation blocked: report the blocker, then use the legacy direct-write procedure in `AGENTS.md`.

## Read Requests

Resolve the configured vault, then read it directly. Keep read-only work transaction-free.
