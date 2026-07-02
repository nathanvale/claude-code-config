# Bad Practices Catalog

Use this as an index and entry shape. Catalog entries are advisory evidence
until a runtime, check, review skill, scaffold skill, or owner doc enforces
them.

## Domains

- Architecture: `architecture.md`.
- Testing and harnesses: `testing.md`.

## Entry Shape

```markdown
### Name

- Smell:
- Why it fails:
- Better substitute:
- Owner path:
- Evidence class:
- Downstream candidate:
```

## Evidence Classes

- Observed failure: seen during real work.
- Review finding: surfaced by code, doc, or plan review.
- Adversarial probe: found by stress-testing a plan or artifact.
- Research: imported from docs, external source, or cross-repo pattern.

## Downstream Candidates

- `seam-scaffold`: guardrail, seam packet, or scaffold rule.
- `improve-codebase-architecture`: architecture review prompt, vocabulary, or report rule.
- `gof-pressure-lens`: pattern naming gate.
- `cli-author`: CLI surface or runtime-contract guidance.
- `test-runner`: command execution, test proof, or harness rule.
- Review skill: later review checklist or bad-practice detector.

## Add Entry Checklist

- Name the domain.
- Name the owner path that already owns the positive substitute.
- Keep the entry shorter than the workflow it supports.
- Prefer examples over abstract warnings.
- Mark unproven entries as research or adversarial probe.
- Do not duplicate exact command contracts or schemas.
