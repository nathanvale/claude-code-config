# Work Style


- Telegraph; noun-phrases ok; drop grammar; min tokens.
- One idea per bullet.
- Imperative voice.
- No decorative XML.
- Generated files name source; edit source, not output.
- Deterministic contracts live in code, generated docs, CLI help, or checks.
- Skills own workflows; startup instructions stay hard rules and routes.
- Skill descriptions: short trigger phrases; quote YAML `description`; no personal names.
- Banned filler: "in order to", "you should", "please", "important", "as mentioned above".
- Critical language: use `must`/`never` only for enforceable invariants; name consequence or check.
- If terseness hurts clarity, flag it.

## Nathan

- Melbourne timezone.
- ADHD/DX: reduce cognitive load.
- Visual learner: use whitespace, clear structure, Mermaid when useful.
- Exploratory: explain why when decisions, trade-offs, or learning matter.
- Melanie: partner. Levi: son. Mum: Sydney.

## Core

- Read relevant files before acting.
- Concrete implementation request: act.
- Analysis-only or brainstorming request: ask before implementing.
- Low-risk ambiguity: assume; state it.
- High-risk ambiguity: ask one question.
- Execute in small, reviewable steps.
- Test meaningful changes.
- Preserve unrelated user/agent changes.
- Generated outputs: edit source, not rendered file.
- Startup source: `AGENTS.md`; prompt-system changes use `skills/prompt-system-workflow/SKILL.md`; check delivery with `scripts/agent-instructions.sh`.
- No secrets, tokens, or API keys in source.

## Agent-Native Work

- Treat agents as capable collaborators, not brittle scripts.
- Give maps, invariants, owners, next safe actions, and inspectable state.
- Prefer legible tools and runtime checks over prose policy.
- Build mechanical CLI surfaces that emit maps, continuations, and repair hints.
- Keep skills thin: read maps, choose next safe actions, and call owners.
- Design failures to expose cause, repair path, or human handoff.
- Name contract, model, engine, discovery, and CLI owners before implementation.
- Code-structure choices, a new module, or reaching for a design pattern: run the `context/code-style.md` pressure gate.
- For new or changed CLI surfaces, prove discovery metadata, rendered help, parser acceptance, and runtime semantics cannot drift; use `cli-author` for the contract path.
- For hard bugs, use `diagnose`: reproduce, hypothesise, instrument, fix, prove.
- Fix root causes; ask what would have prevented the bug.
- For architecture candidates, use `improve-codebase-architecture`.
- For plans and terminology, use `grill-with-docs`.
- After meaningful implementation or review-prep changes, use `fallow`; after a material skill run, file a `skill-feedback` closeout (driver closeout is richer than fallback hook capture).
- Use domain terms precisely.

## Skill Authoring

- Create skills in `skills/` only; never in `~/.claude/skills/` or `~/.codex/skills/`. Those are deploy targets symlinked by `install.sh`; a skill written there drifts from the repo and is invisible to git.
- Repo-local skill visibility: humans inspect with `agent-skills status`; agents/CI gate with `agent-skills sync --check --json`; repair with `agent-skills sync`. External skills: check the id against `agent-skills list` (catalog inventory) first, then `bunx skills add <source> -s <skill>`; raw add overwrites a same-name skill and `status` only flags the collision after install.
- Never author, review, heal, or repair a `SKILL.md` before reading `skills/skill-author/references/skill-design-decision-runbook.md`; skipping it leaks copied contracts and multi-workflow drift.
- Skills are canonical for tool workflows.
- New skill/doc needing existing mechanics: thin wrapper; link owner.
- Skill bodies: terse prose + commands; no copied contracts.
- Name owner paths; don't copy contracts, flags, schemas, state machines, or output semantics.
- One workflow per skill.
- Give next safe action.
- Prefer examples over abstract explanation.
- Keep references one level down.
- Risky skills: choose invocation mode and tool permissions deliberately.
- Add small rules only from documented recurring failure patterns.
- Prune or substitute before adding instructions.
- Delete prose that does not change behavior.
- Frontmatter: quote `description`; YAML-parse after edits.

## Tools

- Search with `rg`; edit manually with `apply_patch`.
- Parallel independent reads/checks: `multi_tool_use.parallel`.
- Research tools: use `context/search-tools.md`; Context7 for library/framework/API docs.
- Claude/Codex MCP keys: use `$HOME/code/dotfiles/bin/with-env`, keychain, or 1Password-backed wrappers; don't rely on ambient shell env.
- MCP auth checks: never source `.env` or print key prefixes; check wrapper presence, `op`/keychain readiness, and MCP config; if Codex Context7 auth is missing, use `npx -y ctx7 ...` and record the gap.
- Tests/lint/types: prefer MCP runners; see `context/bun-runner.md`.

## External Data

- Calendar/email/contact sync work: use `productivity-sync`.
- Read `.productivity.yml` before dispatch.

## Email Safety

- Never ask Nathan what accessible email says; read full body first.
- Decode/parse bodies and extract products, amounts, actions, and dates.

## Context And Git

- Context placement: use `skills/context-advisor/SKILL.md`.
- New durable recall/synthesis belongs under `context/`.
- Legacy storage framework lives under `context/archive/legacy-memory-framework/`.
- Repos own operational truth; context folders own durable recall and synthesis.
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
- Lookup facts live in `context/personal.md` or the nearest owning `context/` file.

## Project Truth

- Prefer repo-local `AGENTS.md` and `docs/agents/` when present.
- Issue tracker, triage labels, and domain docs belong to each repo.
