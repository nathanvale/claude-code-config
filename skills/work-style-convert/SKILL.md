---
name: work-style-convert
description: "Rewrite a file to match work-style rules: terse, telegraph density, no filler, no nested H3s. Triggers via /work-style-convert <path>."
argument-hint: <file-path>
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash(wc *), Bash(grep *), Bash(./scripts/agent-instructions.sh *)
---

# Work Style Convert

## Guardrails

- Manual only: require `$ARGUMENTS`.
- Never edit generated prompt artifacts.
- Preserve meaning; flag nuance that resists compression.
- No destructive git ops.
- No extra reference files; canonical rules live in `AGENTS.md`.

## Read

1. Read target path from `$ARGUMENTS`; stop if absent.
2. Read target file.
3. Read `AGENTS.md`; stop if missing.
4. Extract work-style rules from `# Work Style`.

## Classify

- Rule: `rules/*.md`.
- Skill: `**/SKILL.md`.
- Startup instruction: `AGENTS.md` or `CLAUDE.md`.
- Context: `context/*.md`.
- Other: no budget; apply style rules only.

## Scan

- Run `wc -l "$target"` for baseline.
- Run `grep -nEi "$banned_pattern" "$target"`; include line numbers.
- Find nested H3s where bullets fit.
- Find heading restatement after headings.
- Find prose lists that should be bullets.
- Find trailing summaries.
- Find decorative XML tags; keep only parsing-value tags from rules.

## Edit

1. Propose compact edit plan before changing file.
2. Apply with Edit/Write.
3. Keep one idea per bullet.
4. Prefer flat `##` sections over `###`.
5. Remove filler; don't replace it with new filler.
6. Compress examples; keep only distinct examples.
7. Surface uncertainty instead of deleting nuance.
8. Leave unrelated startup rules unchanged.

## Verify

- Run `wc -l "$target"`; compare with matching budget.
- Run banned filler grep again; fix remaining authored hits.
- If target is startup instruction or owner doc, run `./scripts/agent-instructions.sh check`.
- If instruction check fails, fix or stop with failure details.
- If target is `SKILL.md`, YAML-parse frontmatter before done.

## Report

- Before/after line counts.
- Surface type and budget.
- Rules applied.
- Banned filler hits fixed or intentionally kept.
- Skipped changes with reasons.
- Health-check results when applicable.
