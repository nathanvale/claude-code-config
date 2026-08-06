# Durable Knowledge Vault

Status: pilot

Vault root: `/Users/nathanvale/code/my-second-brain-vault-spike`

## Entry

1. Read the vault root `AGENTS.md`.
2. Read the vault root `README.md`.
3. Read the destination family `README.md` before writing.
4. Update the canonical existing note before creating another one.

## Ownership

The vault owns Nathan's plans, research, synthesis, project memory, status,
personal reasoning, handoffs, durable lessons, and cross-repository context.

Code repositories own their repo-facing instructions, `README.md`,
`CONTEXT.md` glossary, accepted ADRs, API schemas, generated documentation,
deterministic contracts, code, tests, runtime state, and changelog.

Link between owners. Do not copy the same truth into both places.

## Write Authority

- An explicit foreground request may create or update a scoped vault note after
  reading the vault rules.
- A delegated, background, or ambiguous request proposes the target and change
  unless its handoff explicitly grants vault-write authority.
- Preview bulk, structural, destructive, privacy-sensitive, public, or
  cross-corpus changes.

## Migration Boundary

This path targets the local pilot. Change `Vault root` only after the production
repository is approved and ready. Do not create a second vault when the path is
missing or stale; report the broken route and stop.
