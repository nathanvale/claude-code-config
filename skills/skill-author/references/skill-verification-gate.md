# Skill Verification Gate

Use when choosing checks, handoff evidence, or post-edit verification for skill source changes.

## Verification

- Description changes: `bun run skills/skill-author/scripts/skill-description-audit.ts --json`.
- Frontmatter changes: YAML parse the edited `SKILL.md`.
- Owner-path changes: `bun run skills/skill-author/scripts/check-owner-paths.ts --json`.
- Gotcha decision artifacts: `bun run skills/skill-author/scripts/check-gotcha-decision.ts --json <artifact>`.
- Skill route changes: `./setup sync --check --json`.
- Global instruction route changes: invoke `agent-instructions` manually and prove fresh native loading.

## Handoff

- Report edited paths.
- Report new references.
- Report untracked files.
- Report skipped checks.
- Report owner-path results.
- For create, fix, heal, repair, or patch source edits, report `deletion test`: kept, moved, deleted, or none.
- Return owner file, check result, next safe action, and user-facing skill follow-up.

## Review-Only Route

- Use `references/skill-review-rubric.md`.
- Keep review-only runs read-only unless the user asks to patch.
- Do not load edit gates for a review-only branch.
