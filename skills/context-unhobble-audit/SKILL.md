---
name: context-unhobble-audit
description: "Audit a repository's startup instructions, skills, tool guidance, memory, and references for context bloat, conflicts, repetition, obsolete scaffolding, or prose-owned contracts."
role: quality-gate
argument-hint: "[repo-path or context surface]"
disable-model-invocation: true
---

# Context Unhobble Audit

Run a read-only audit. With no arguments, inspect the current repository.
Inspect active context delivery, not every Markdown file by default.

## Route

1. Resolve the target repo and read its nearest agent instructions, Claude
   instructions, context vocabulary, and relevant architecture decisions when
   present.
2. Map context surfaces before judging them: always loaded, path-scoped,
   skill-triggered, tool-owned, runtime-emitted, retrieval-only, and historical.
3. Choose the smallest useful scope. Start with startup files and active skills;
   follow references only when a live route or candidate finding depends on them.
4. Read [references/audit-lens.md](references/audit-lens.md).
5. Run repo-native instruction, skill, owner-path, and drift checks first. Use
   targeted searches only for gaps those checks do not cover.
6. Trace each candidate to its owner, runtime behavior, help, schema, test, or
   conflicting instruction before calling it a finding.
7. Return findings. Do not edit, delete, archive, or rewrite context unless the
   user separately asks for implementation.

## Evidence Gate

- Treat line count, rule count, comment count, examples, and file type as
  discovery signals only.
- Require a path and tight line reference for every finding.
- For conflicts or repetition, name both instruction surfaces and the owner.
- For obsolete guidance, prove current runtime, tool, hook, help, or test
  behavior differs.
- For eager loading, show that the surface enters requests where it is not
  needed; a large retrieval-only document is not startup bloat.
- For deletion candidates, name what preserves safety, authority, product
  knowledge, or verification after removal.
- Keep useful code comments. Flag comments only when they restate code, carry a
  drifting contract, or conflict with the surrounding codebase.

## Boundaries

- Preserve enforceable safety and authority invariants unless code or runtime
  controls replace them.
- Preserve repo-specific gotchas that the model cannot infer from code, tests,
  help, or filesystem structure.
- Do not apply an arbitrary reduction target. Compare task quality and context
  cost through repo-owned checks or a scoped evaluation.
- Do not treat auto-memory as an owner for critical contracts or operational
  state.

## Output

Lead with findings ordered by user impact. For each finding, give the path,
principle, evidence, consequence, and smallest direction. Then name clean
surfaces, skipped probes, and the next safe action.
