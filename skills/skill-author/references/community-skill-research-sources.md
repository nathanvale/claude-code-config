# Community Skill Research Sources

Use this source note before changing community-skill rules reached from `references/skill-design-decision-runbook.md`.

Keep accepted rules in the owning `skill-author` reference. Keep source freshness here.

## Current Sources

- Claude Code skills docs: `https://code.claude.com/docs/en/skills`
  - Checked: 2026-06-08.
  - Use for filesystem skill shape, frontmatter, Markdown skill instructions, invocation controls, supporting files, and token-budget guidance.
- Claude Code SDK skills docs: `https://code.claude.com/docs/en/agent-sdk/skills`
  - Checked: 2026-06-08.
  - Use for SDK skill discovery, setting sources, tool restriction boundaries, and skill filtering caveats.
- Claude Code memory docs: `https://code.claude.com/docs/en/memory`
  - Checked: 2026-06-08.
  - Use for `CLAUDE.md` versus auto memory, storage, audit/edit, and enforcement boundaries.
- Claude Code settings docs: `https://code.claude.com/docs/en/settings`
  - Checked: 2026-06-08.
  - Use for user, project, local, and managed configuration scopes.
- OpenAI Codex manual: `https://developers.openai.com/codex/codex-manual.md`
  - Checked: 2026-06-08.
  - Use for Codex skill surface, `AGENTS.md`, plugins, MCP, hooks, and customization boundaries.
- OpenAI Codex prompting guide: `https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide`
  - Checked: 2026-06-08 with Firecrawl.
  - Use for `AGENTS.md` injection shape, Markdown-style instruction examples, and agent prompt hygiene.
- Anthropic prompt engineering best practices: `https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags`
  - Checked: 2026-06-08 with Firecrawl.
  - Use for XML-like tags as optional prompt/content boundary aids, not as `SKILL.md` body structure.
- OpenAI prompt engineering docs: `https://developers.openai.com/api/docs/guides/prompt-engineering`
  - Checked: 2026-06-08 with Firecrawl.
  - Use for Markdown plus XML prompt-boundary guidance, not as a skill-file structure contract.
- OpenAI Codex use cases: `https://developers.openai.com/codex/use-cases`
  - Checked: 2026-06-08.
  - Use as official Codex examples for repeatable workflows and saved skills, not as skill-authoring contracts.
- SkillOpt paper: `https://arxiv.org/abs/2605.23904`
  - Checked: 2026-06-08.
  - Use for evidence-loop framing: bounded edits, validation score, rejected edits, and skill optimization from observed runs.
- Local research: `docs/brainstorms/2026-05-30-agent-skills-repo-no-plugins-pivot.md`
  - Use for harness-agnostic skill distribution trade-offs.
- Local research: `docs/research/2026-05-30-skill-composability-handoff-observability.md`
  - Use for composition, handoff, and observability context.
- Local QMD recall hit: `qmd://vault/docs/research/2026-03-22-thariq-applied-analysis.md`
  - Checked: 2026-06-09 with QMD.
  - Discovery only; read the full source before using for gotchas sections, refinement evidence loops, progressive disclosure, skill telemetry, or model-aware gotcha notes.
- Local QMD recall hit: `qmd://vault/docs/research/2026-03-18-claude-code-skills-best-practices.md`
  - Checked: 2026-06-09 with QMD.
  - Discovery only; read the full source before using for skill folder shape, gotchas, description triggers, stored skill memory, helper scripts, config pattern, or on-demand hooks.
- Local ADR: `docs/adr/0010-skill-examples-teach-judgment-not-contracts.md`
  - Checked: 2026-06-09.
  - Use for examples-as-judgment guidance and contract-owner boundaries.

## Example Sources Reviewed

- Agent Skills overview and quickstart: `https://agentskills.io/home`, `https://agentskills.io/skill-creation/quickstart`
  - Checked: 2026-06-08 with Firecrawl.
  - Use for public folder-shape and progressive-disclosure examples.
- OpenAI skills repository: `https://github.com/openai/skills`
  - Checked: 2026-06-08 with Firecrawl.
  - Use for system, curated, and experimental distribution examples.
- Anthropic skills repository: `https://github.com/anthropics/skills`
  - Checked: 2026-06-08 with Firecrawl.
  - Use for public example skill categories and fast-changing repo examples.
- Awesome Claude Skills directory: `https://awesome-skills.com/`
  - Checked: 2026-06-08 with Firecrawl.
  - Use for example review dimensions: code execution, data sent, network, credentials, auto-update, dependencies, and self-contained status.

## Source Rules

- Owner: `references/research-portability.md#source-rules`.
- Keep this file to source notes and checked dates.
- Refresh source notes before changing community-skill rules that depend on current vendor behavior.
