# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

## Layout

This is a single-context repo.

- Root `CONTEXT.md` is the canonical project context if it exists.
- Root `docs/adr/` is the ADR location if it exists.
- If either path is absent, proceed silently and use root `AGENTS.md`,
  `CLAUDE.md`, nearby docs, and code evidence.

## Before exploring, read these

- `CONTEXT.md` at the repo root, when present.
- `docs/adr/`, reading ADRs that touch the area you're about to work in, when
  present.
- The nearest local docs or prompt fragments relevant to the target area.

If context docs do not exist yet, do not create them upfront. The producer
skill creates them lazily when durable terms or decisions actually get
resolved.

## Use the glossary's vocabulary

When your output names a domain concept in an issue title, refactor proposal,
hypothesis, or test name, use the term as defined in `CONTEXT.md` when that
file exists. Do not drift to synonyms the glossary explicitly avoids.

If the concept you need is not in the glossary yet, note it for
`grill-with-docs` rather than inventing durable language in passing.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding it.
