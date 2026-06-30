---
name: bad-practices
description: "Collect, classify, or apply bad-practice knowledge for architecture, testing, scaffolding, review, or AI-slop reduction."
role: advisor
---

# Bad Practices

Use when the user wants a bad-practice knowledge bank, guardrail section,
anti-pattern list, or future scaffold/review-skill input.

## Boundary

- Act as a knowledge bank and translation layer.
- Prefer owner paths over copied contracts.
- Name the better substitute, not only the smell.
- Separate architecture, testing, CLI/runtime, and agent-workflow debt.
- Do not run broad code review unless the user asks.
- Do not replace `improve-codebase-architecture`, `seam-scaffold`, `gof-pressure-lens`, `create-cli`, or `test-runner`.
- Treat catalog entries as advisory until another owner makes them executable.

## Owner Map

- Architecture vocabulary: `skills/improve-codebase-architecture/LANGUAGE.md`.
- Architecture review workflow: `skills/improve-codebase-architecture/SKILL.md`.
- Pattern pressure gate: `context/code-style.md`.
- Seam planning workflow: `skills/seam-scaffold/SKILL.md`.
- Pattern naming referee: `skills/gof-pressure-lens/SKILL.md`.
- CLI design owner: `skills/create-cli/SKILL.md`.
- Test execution owner: `skills/test-runner/SKILL.md`.
- Knowledge bank index: `references/catalog.md`.
- Architecture bad practices: `references/architecture.md`.
- Testing bad practices: `references/testing.md`.

## Pick One

- Architecture or DDD-ish code-shape smell: read `references/architecture.md`.
- Test suite, fixture, harness, or regression smell: read `references/testing.md`.
- Mixed or unknown domain: read `references/catalog.md`, then one domain reference.
- Adding a new entry: append to the relevant reference using the catalog entry shape.
- Preparing a future scaffold/review improvement: return a packet with target skill, owner path, candidate guardrail, and evidence.

## Output Shape

- Domain.
- Bad practice.
- Why it fails.
- Better substitute.
- Owner path.
- Evidence class: observed failure, review finding, adversarial probe, or research.
- Candidate downstream skill: `seam-scaffold`, `improve-codebase-architecture`, `gof-pressure-lens`, `create-cli`, `test-runner`, or review skill.
- Next safe action.

## Safety

- Keep exact schemas, flags, exit codes, and command output in code, CLI help, generated docs, or tests.
- Do not promote a preference into a rule without evidence.
- Do not add a new reference entry when an existing owner already says the same thing.
- Stop as blocked when the domain owner path is missing or the better substitute is unknown.

## Verification

- YAML-parse this file after frontmatter edits.
- Run `bun run skills/skill-author/scripts/check-owner-paths.ts --json` after owner-path edits.

## Next Safe Action

- Classify the bad practice, read the matching reference, then return the smallest useful packet or reference patch.
