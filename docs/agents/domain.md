# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

## Layout

This repo has a root context plus scoped context docs.

- Root `CONTEXT.md` is the canonical project context if it exists.
- Scoped `CONTEXT.md` files own local vocabulary for their folder.
- Root `docs/adr/` is the ADR location if it exists.
- If either path is absent, proceed silently and use root `AGENTS.md`,
  `CLAUDE.md`, nearby docs, and code evidence.

## Before exploring, read these

- `CONTEXT.md` at the repo root, when present.
- The nearest scoped `CONTEXT.md`, when present.
- `docs/adr/`, reading ADRs that touch the area you're about to work in, when
  present.
- The nearest local docs or prompt fragments relevant to the target area.

If context docs do not exist yet, do not create them upfront. The producer
skill creates them lazily when durable terms or decisions actually get
resolved.

## Use the glossary's vocabulary

When your output names a domain concept in an issue title, refactor proposal,
hypothesis, or test name, use the nearest scoped `CONTEXT.md` first, then the
root `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If the concept you need is not in the glossary yet, note it for
`grill-with-docs` rather than inventing durable language in passing.

For architecture deepening, seam naming, module candidates, or architecture
review output, use `improve-codebase-architecture`. It consumes `CONTEXT.md`
domain language and ADRs so refactor candidates use domain terms instead of
file names or invented architecture labels.

Do not copy architecture vocabulary from `improve-codebase-architecture` into
`CONTEXT.md`. Keep module, interface, seam, adapter, depth, leverage, and
locality in the architecture skill owner.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding it.
