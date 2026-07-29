# Architecture Bad Practices

Use with `skills/improve-codebase-architecture/LANGUAGE.md`,
`context/code-style.md`, `skills/seam-scaffold/SKILL.md`, and
`skills/gof-pressure-lens/SKILL.md`.

## Catalog

### Pattern-first design

- Smell: choosing Strategy, Factory, Adapter, registry, or plugin names before pressure is named.
- Why it fails: the pattern becomes decorative and hides the real seam question.
- Better substitute: name pressure source, seam, deletion-test consequence, locality or leverage, and the second adapter.
- Owner path: `context/code-style.md`.
- Evidence class: observed failure.
- Downstream candidate: `gof-pressure-lens`, `seam-scaffold`.

### Shallow module extraction

- Smell: extracting a module whose interface is nearly as complex as its implementation.
- Why it fails: caller complexity does not decrease; the agent now has more files to inspect.
- Better substitute: keep code local until deletion test shows complexity would reappear across callers.
- Owner path: `skills/improve-codebase-architecture/LANGUAGE.md`.
- Evidence class: observed failure.
- Downstream candidate: `improve-codebase-architecture`, `seam-scaffold`.

### Test-only seam

- Smell: adding an interface only so tests can mock one implementation.
- Why it fails: one adapter is hypothetical pressure and taxes every reader.
- Better substitute: test through the real interface, or add a seam only when production plus fake or a second real adapter exists.
- Owner path: `context/code-style.md`.
- Evidence class: observed failure.
- Downstream candidate: `seam-scaffold`, review skill.

### Domain-language bypass

- Smell: naming modules around technical nouns while `CONTEXT.md` already names the domain concept.
- Why it fails: seams stop matching the user's model, so agents chase infrastructure instead of meaning.
- Better substitute: read the nearest `CONTEXT.md`; name modules, packets, and decisions with domain terms.
- Owner path: `skills/improve-codebase-architecture/SKILL.md`.
- Evidence class: review finding.
- Downstream candidate: `improve-codebase-architecture`, `seam-scaffold`.

### ADR amnesia

- Smell: proposing architecture that contradicts existing ADRs without naming the conflict.
- Why it fails: reviewers relitigate settled decisions or miss the cost of reopening them.
- Better substitute: read relevant `docs/adr/` files and mark real conflicts explicitly.
- Owner path: `skills/improve-codebase-architecture/SKILL.md`.
- Evidence class: review finding.
- Downstream candidate: `improve-codebase-architecture`.

### Premature public API

- Smell: exporting a helper before a caller outside the module needs it.
- Why it fails: private movement becomes public compatibility debt.
- Better substitute: keep helpers private until a second caller or contract owner appears.
- Owner path: `context/code-style.md`.
- Evidence class: observed failure.
- Downstream candidate: review skill, `seam-scaffold`.

### Fat-file panic split

- Smell: splitting a large file by line count before naming reasons to change.
- Why it fails: moves code without improving locality or leverage.
- Better substitute: map existing seams first, then move only along pressure-backed boundaries.
- Owner path: `skills/seam-scaffold/SKILL.md`.
- Evidence class: observed failure.
- Downstream candidate: `seam-scaffold`.
