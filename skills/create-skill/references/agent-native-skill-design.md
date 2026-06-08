# Agent-Native Skill Design

Use when a skill needs a runtime helper, machine-readable output, durable writes,
or agent-facing recovery behavior.

Do not use for ordinary prose-only skills.

## Owner Paths

- Skill philosophy: `skill-design-philosophy.md`.
- Agent-native CLI design layer owner path: `skills/create-cli/SKILL.md`.
- Agent-native CLI guidance: `skills/create-cli/references/agent-native-cli-design.md`.
- Facade-backed CLI path: `skills/create-cli/references/cli-command-facade.md`.
- Example skill shapes: `skill-io-shape-examples.md`.
- Worked example: `skills/decisions/references/operating-manual.md`.
- Decision memory: `docs/decisions/`.

## Workflow

1. Start from the idea, brainstorm, or observed failure.
2. Grill one decision at a time until the skill boundary is clear.
3. Record accepted decisions when durable memory is useful.
4. Decide whether a runtime-backed capability is earned.
5. Define the package-owned TypeScript input contract.
6. Define the package-owned output `data` vocabulary.
7. Use facade-owned runtime envelopes for output transport when facade-backed.
8. Name contract, model, engine, discovery, CLI, and test owner paths.
9. Run `create-cli` before adding or changing command surfaces.
10. Write `SKILL.md` as entry-screen route clarity plus owner paths.
11. Put exact contracts in code, help, generated docs, and tests.
12. Prove discovery metadata, rendered help, parser acceptance, and runtime semantics cannot drift.

## Input Contract

- Use a prose input envelope when humans or agents supply intent.
- Keep exact TypeScript types, parser behavior, defaults, validation, and repair mapping in runtime-owned files.
- Require explicit fields for side effects, ownership, durability, privacy, and acceptance.
- Reject hidden inference for owners, sources, execute mode, and personal/private scope.
- Route missing or blocked input to repair guidance, not silent defaults.

## Output Contract

- Follow the CLI command facade TypeScript envelope when the command is facade-backed.
- Put package-specific success, repair, and safety payloads inside facade-owned output envelopes.
- Keep exact output fields, statuses, action names, diagnostic codes, retry categories, and envelope details in code, help, and tests.
- Use success data to prove the plan or mutation result.
- Use repair data to tell the caller what to change.
- Use safety data to tell the caller what changed and whether retry is safe.

## Skill Shape

- Keep `SKILL.md` thin.
- Route by trigger, boundary, owner paths, safety gate, command, and next safe action.
- Add `references/` only after repeated use exposes reusable detail that would bloat `SKILL.md`.
- Add `scripts/` only for repeated deterministic work.
- Do not copy flags, schemas, state machines, facade fields, or generated output shapes into skill prose.

## Next Safe Action

- If the command surface is not designed, run `create-cli`.
- If the skill boundary is unresolved, use `decision-mode` or `grill-with-docs`.
- If the contract is ready, implement the runtime owner files and tests before widening skill prose.
