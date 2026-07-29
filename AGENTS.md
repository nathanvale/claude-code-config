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
- Startup source: `$HOME/code/claude-code-config/AGENTS.md`; prompt-system changes use `$HOME/code/claude-code-config/skills/prompt-system-workflow/SKILL.md`; check delivery with `$HOME/code/claude-code-config/scripts/agent-instructions.sh`.
- No secrets, tokens, or API keys in source.

## Agent-Native Work

- Treat agents as capable collaborators, not brittle scripts.
- Give maps, invariants, owners, next safe actions, and inspectable state.
- Prefer legible tools and runtime checks over prose policy.
- Build mechanical CLI surfaces that emit maps, continuations, and repair hints.
- Keep skills thin: read maps, choose next safe actions, and call owners.
- Design failures to expose cause, repair path, or human handoff.
- Name contract, model, engine, discovery, and CLI owners before implementation.
- Code-structure choices, a new module, or reaching for a design pattern: run the `$HOME/code/claude-code-config/context/code-style.md` pressure gate.
- For new or changed CLI surfaces, prove discovery metadata, rendered help, parser acceptance, and runtime semantics cannot drift; use `cli-author` for the contract path.
- Connect browser adapters only through `browser-connect connect --json`; workflow: `$HOME/code/claude-code-config/skills/browser-use/SKILL.md`.
- For hard bugs, use `diagnosing-bugs`: reproduce, hypothesise, instrument, fix, prove.
- Fix root causes; ask what would have prevented the bug.
- For architecture candidates, use `improve-codebase-architecture`.
- For plans and terminology, use `grill-with-docs`.
- After meaningful implementation or review-prep changes, use `fallow`; after a material skill run, file a `skill-feedback` closeout (driver closeout is richer than fallback hook capture).

## Skill Authoring

- For any first-party skill create/update request, edit the canonical source under `$HOME/code/claude-code-config/skills/<id>/` regardless of the current project; never edit generated `~/.claude/skills/` or `~/.agents/skills/` projections.
- After any first-party skill change, run `setup sync --check --json`; follow with `setup sync` after add/rename/remove or when Nathan asks to sync. Content-only edits use live projections, so a clean check needs no apply. Otherwise inspect with `setup catalog`; preflight named third-party work with `setup catalog <id>`, then use `skills-sync` to change `skills-sources.yml`, regenerate `skills-lock.json`, and restore verified projections.
- Never author, review, heal, or repair a `SKILL.md` before reading `$HOME/code/claude-code-config/skills/skill-author/references/skill-design-decision-runbook.md`; skipping it leaks copied contracts and multi-workflow drift.
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
- Research tools: use `$HOME/code/claude-code-config/context/search-tools.md`; Context7 for library/framework/API docs.
- Claude/Codex MCP keys: use `$HOME/code/dotfiles/bin/with-env`, keychain, or 1Password-backed wrappers, not ambient shell env; for auth checks never source `.env` or print key prefixes, check wrapper presence, `op`/keychain readiness, and MCP config; if Codex Context7 auth is missing, use `npx -y ctx7 ...` and record the gap.
- Tests/lint/types: prefer MCP runners; see `$HOME/code/claude-code-config/context/bun-runner.md`.
- Homebrew additions/removals: edit `$HOME/code/dotfiles/config/brew/Brewfile` first; install with `brew bundle` and remove with previewed `brew bundle cleanup`; never run direct `brew install`, `brew uninstall`, or `brew tap`, because they create untracked machine drift; verify with `brew bundle check`. Homebrew 6.0+ refuses non-official taps until `brew trust <tap>` is run once for a newly added tap. Full workflow: `$HOME/code/dotfiles/AGENTS.md`.
- Mac Mini server SSH (connect, flaky/dropped SSH, dedicated key, durable cmux/tmux): use the `mac-mini-ssh` skill.

## External Data

- Google services: use `gog`; never use native Claude Code or Codex Google connectors/apps (Gmail, Calendar, Drive, Docs, Sheets, Contacts).
- Read the nearest `.productivity.yml` before Google dispatch; for calendar/email/contact sync, use `productivity-sync`.

## Email Safety

- Never ask Nathan what accessible email says; read full body first.
- Decode/parse bodies and extract products, amounts, actions, and dates.

## Context And Git

- Context placement: use `$HOME/code/claude-code-config/skills/context-advisor/SKILL.md`.
- New durable recall/synthesis belongs under `$HOME/code/claude-code-config/context/`.
- Legacy storage framework lives under `$HOME/code/claude-code-config/context/archive/legacy-memory-framework/`.
- Repos own operational truth; context folders own durable recall and synthesis.
- Git procedure: `$HOME/code/claude-code-config/docs/git/`.
- Never force push, hard reset, `clean -f`, or `checkout/restore .`.
- Never use `git add .` or `git add -A`.
- Ask before commits, branch changes, destructive ops, broad refactors, new deps, or unclear ownership.
- Protected branches: no direct commits.

## Communication

- Chat tone: warm, concise, low-cognitive-load; plain words and short sentences for a smart, non-technical reader; no em or en dashes.
- Reply shape: answer in one or two lines and stop when enough; otherwise use `Details` bullets, direct `What I need to do`, and brief `Also found`; skip preambles, process narration, padding, and routine offers.
- Questions and failures: ask one question with options and a reasoned recommendation; state what broke, user impact, and the next action; omit logs unless asked.
- Long writing: let drafts, scripts, posts, and documents use the form the work needs; outbound style owner: `$HOME/code/claude-code-config/context/comms-style.md`.

## Personal Context

- Keep relationship labels only when contextually relevant.
- Lookup facts live in `$HOME/code/claude-code-config/context/personal.md` or the nearest owning `$HOME/code/claude-code-config/context/` file.

## Project Truth

- Prefer repo-local/package-local `AGENTS.md` when present.
- Issue tracker, triage labels, and domain docs belong to each repo.
