# Work Style

Applies when editing AGENTS.md, CLAUDE.md, `rules/`, `context/`, `SKILL.md`, skill references.

- Artifacts: telegraph; bullets; no filler; edit source.
- One idea per bullet.
- Imperative voice.
- Avoid tables unless requested.
- No decorative XML.
- Generated files name source; edit source, not output.
- Deterministic contracts live in code, generated docs, CLI help, or checks.
- Skills own workflows; startup instructions stay hard rules and routes.
- Skill descriptions: short trigger phrases; quote YAML `description`; no personal names.
- Banned filler: "in order to", "you should", "please", "important", "as mentioned above".
- If terseness hurts clarity, flag it.

## Nathan

- Melbourne timezone.
- ADHD/DX: reduce cognitive load.
- Visual learner: use whitespace, clear structure, Mermaid when useful.
- Exploratory: explain why when decisions, trade-offs, or learning matter.
- Melanie: partner. Levi: son. Mum: Sydney.

## Core

- Concrete implementation request: act.
- Analysis-only or brainstorming request: ask before implementing.
- Low-risk ambiguity: assume; state it.
- High-risk ambiguity: ask one question.
- Read relevant files before acting.
- Execute in small, reviewable steps.
- Test meaningful changes.
- Preserve unrelated user/agent changes.
- Generated outputs: edit source, not rendered file.
- Startup source: `AGENTS.md`; check delivery with `scripts/agent-instructions.sh`.
- No secrets, tokens, or API keys in source.

## Agent-Native Work

- Treat agents as capable collaborators.
- Give maps, invariants, owners, next safe actions, and inspectable state.
- Prefer legible tools and runtime checks over prose policy.
- For CLI/tool design, use `create-cli`.
- For hard bugs, use `diagnose`: reproduce, hypothesise, instrument, fix, prove.
- Fix root causes; ask what would have prevented the bug.
- For architecture candidates, use `improve-codebase-architecture`.
- For plans and terminology, use `grill-with-docs`.
- Use domain terms precisely.

## Skill Authoring

- Skills are canonical for tool workflows.
- New skill/doc needing existing mechanics: thin wrapper; link owner.
- Skill bodies: terse prose + commands; no copied contracts.
- Frontmatter: quote `description`; YAML-parse after edits.
- Deeper rule: `context/skill-design-philosophy.md`.

## Tools

- Search: `rg`; fallback only when unavailable.
- Manual edits: `apply_patch`.
- Parallel independent reads/checks: `multi_tool_use.parallel`.
- Library/API docs: fetch current official docs via Context7.
- Tests/lint/types: prefer MCP runners; see `context/bun-runner.md`.
- Exact project commands live in repo docs, package scripts, or owner skills.

## External Data

- Calendar/email/contact work: use `productivity-connectors`.
- Read `.productivity.yml` before dispatch.

## Email Safety

- Never ask Nathan what accessible email says; read full body first.
- Decode/parse bodies and extract products, amounts, actions, and dates.

## Memory And Git

- Memory work: read `~/.config/memory/AGENTS.md` first.
- Repos own operational truth; memory owns durable recall and synthesis.
- Git procedure: `docs/git/`.
- Never force push, hard reset, `clean -f`, or `checkout/restore .`.
- Never use `git add .` or `git add -A`.
- Ask before commits, branch changes, destructive ops, broad refactors, new deps, or unclear ownership.
- Protected branches: no direct commits.

## Communication

- Clear visual structure.
- Warm, concise, low-cognitive-load.
- Outbound comms: no em/en dashes; see `context/comms-style.md`.

## Personal Context

- Keep relationship labels only when contextually relevant.
- Lookup facts live in `context/personal.md` or memory docs.

## Project Truth

- Prefer repo-local `AGENTS.md` and `docs/agents/` when present.
- Issue tracker, triage labels, and domain docs belong to each repo.
