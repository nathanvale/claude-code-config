# Skill Owner Path Gate

Use when creating or repairing owner paths, references, contract pointers, and path authority.

## Owner Paths

- Name the owner path instead of copying the contract.
- Treat the owner path as the `single source of truth`.
- Keep exhaustive owner maps in references unless needed for the next action.
- On the first screen, name only the owner anchor needed to route, halt, or continue.
- If no authoritative owner path exists, do not rely on the behavior as a contract.
- For examples, mark illustrative.
- For exact behavior, create or name the owner before relying on it.
- For unsafe ambiguity, stop as blocked.
- Code, CLI help, generated docs, tests, and scripts own deterministic behavior.
- Use `## Contract` only to point at the authoritative owner path.

## Verification

- Run owner-path checks after adding, renaming, removing, or retargeting local owner paths: `bun run skills/skill-author/scripts/check-owner-paths.ts --json`.
- Resolve `references/`, `scripts/`, `CONTEXT.md`, and `SKILL.md` from the owning skill root.
- Write package and config owner paths with enough path context to check them, such as `skills/<name>/package.json` or `runtime/<name>/tsconfig.json`.
- Resolve missing owners before handoff, or record the blocked state and next repair.
