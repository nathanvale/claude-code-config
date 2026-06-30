# Skill Verification Gate

Use when choosing checks, handoff evidence, or post-edit verification for skill source changes.

## Verification

- Description changes: `bun run skills/create-skill/scripts/skill-description-audit.ts --json`.
- Role changes: `bun run skills/create-skill/scripts/skill-role-audit.ts --json`.
- Frontmatter changes: YAML parse the edited `SKILL.md`.
- Owner-path changes: `bun run skills/create-skill/scripts/check-owner-paths.ts --json`.
- Gotcha decision artifacts: `bun run skills/create-skill/scripts/check-gotcha-decision.ts --json <artifact>`.
- Startup route changes: `scripts/agent-instructions.sh check --json`.

## Handoff

- Report edited paths.
- Report new references.
- Report untracked files.
- Report skipped checks.
- Report owner-path results.
- Return owner file, check result, next safe action, and user-facing skill follow-up.

## Review-Only Route

- Use `references/skill-review-rubric.md`.
- Keep review-only runs read-only unless the user asks to patch.
- Do not load edit gates for a review-only branch.
