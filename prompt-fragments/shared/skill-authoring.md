## Skill Authoring

Hard rules for authoring skills and editing `SKILL.md` files.

- **Default to prose-trust, steipete weight.** Contracts where a machine parses; prose where a model reads. Skill bodies are model-read → terse prose + commands, rules as fail-closed bullets, no enforcement machinery. Keep deterministic contracts only at machine-parsed boundaries (frontmatter shape, renderers, extractors, runbooks). Refuse edge cases in prose; don't engineer around them. See `context/skill-design-philosophy.md`.
- Skills are canonical for tool workflows. Keep CLAUDE.md / AGENTS.md to hard rules only.
- Editing AGENTS.md, CLAUDE.md, skills, or skill references: token-efficient, relaxed grammar, terse descriptions. See `work-style.md` shared fragment for the bar.
- Skill descriptions: short generic trigger phrase, not a summary. No personal names, long paths, or workflow narration unless required for routing.
- Skill frontmatter: quote the `description` value. After editing a `SKILL.md`, YAML-parse the frontmatter before commit.
