<!-- GENERATED — do not edit directly. Edit fragments in $HOME/code/claude-code-config/prompt-fragments/ and run: $HOME/code/claude-code-config/scripts/render-user-prompts.sh --write -->

# Work Style

Applies when editing AGENTS.md, CLAUDE.md, `prompt-fragments/`, `rules/`, `context/`, SKILL.md, skill references.

- Telegraph; noun-phrases ok; drop grammar; min tokens.
- Codex CLI: avoid tables; render poorly. Use bullets or `key: value`. Tables only on request.
- One idea per bullet. No sub-bullets unless meaning fragments.
- Imperative voice. Active. Contractions fine. Drop articles when meaning survives.
- Don't restate the heading in the first line.
- No trailing summaries.
- Bullets > prose for any list.
- Skills canonical for tool workflows. Keep AGENTS.md / CLAUDE.md to hard rules only.

## XML tags

- Default: plain markdown in rule/fragment/skill/policy bodies. No XML.
- Use XML only when it earns parsing payoff: few-shot `<example>` / `<examples>`, long docs `<document>` / `<document_content>` / `<source>`, output routing `<thinking>` / `<answer>` / `<quotes>`.
- Use Anthropic's conventional tag names; lowercase_with_underscores; nest only on real hierarchy.
- No decorative wrapping (`<rule>`, `<note>`) when markdown headings or bullets work.

## Banned filler

"in order to", "you should", "make sure to", "please", "please note", "note that", "it is important to", "importantly", "as mentioned above", "the following" before lists, "this is a X that Y".

## Line budgets

- Rule: soft 20, hard 30.
- Shared fragment: soft 25, hard 40.
- Harness fragment: soft 15, hard 25.
- AGENTS.md rendered: soft 200, hard 250.
- CLAUDE.md rendered: soft 30, hard 50.
- Skill `description`: soft 240ch, hard 320ch.
- Over soft fine. Over hard justify in commit.

## Skill descriptions

- Trigger phrase, not summary.
- No personal names. No long paths. No workflow narration.
- Quote the value. YAML-parse before commit.
- Bad: `description: Helps Nathan draft professional messages for Slack, Teams, or email by following a tone checklist...`
- Good: `description: "Draft Slack, Teams, or email messages. Triggers on 'draft a message', 'email X'."`

## When to break

Clarity beats terseness. If a rule fights the reader, flag it.

## Nathan's Preferences

- **Location** → Melbourne, Australia (AEST/AEDT)
- **ADHD** → Cognitive load is my enemy. DX matters enormously.
- **Visual learner** → Clear structure, whitespace, formatting help me process.
- **Exploratory** → I want to learn from what you do. Explain the "why."

## Always Do

- Read relevant files before acting.
- Plan explicitly for complex tasks before implementation.
- Execute in small, reviewable steps.
- Test each meaningful change with appropriate checks.
- Explain what changed and why.
- Document exported functions with JSDoc or comments when the why isn't obvious.

## Ask First

- Before implementing after an analysis-only or brainstorming request.
- Before refactors that change structure beyond the requested fix.
- Before commits, branch changes, or actions with non-obvious consequences.
- Before defaulting to the current repo when ownership is unclear.
- Before adding new dependencies — check if an existing dep or stdlib solves it.

## Never Do

- Delete untracked git changes.
- Implement without confirmation.
- Use destructive git commands like `reset --hard`, `clean -f`, or force push.
- Hardcode secrets, tokens, or API keys in source files.
- Create nested `biome.json` files in monorepos.
- Use generic write or edit flows for Obsidian vault content.

## Workflow

Plan → Confirm → Execute → Test:

1. Read relevant code and docs first.
2. Make a clear plan when the task is non-trivial.
3. Confirm with Nathan before implementation.
4. Execute incrementally in small chunks.
5. Verify with the right checks as you go.
6. Explain the result and the reasoning.

## Working Preferences

- Tests, lint, type checks: prefer MCP runners (bun-runner, biome-runner, tsc-runner). Fall back to repo CLI (package.json scripts or repo wrapper) when no runner fits. Raw Bash last resort.
- Prefer machine-readable output for tool-to-tool interfaces.
- Prefer `bunx` over `npx` for package execution.
- Prefer bun ecosystem and TypeScript over Python or other languages.
- Reference docs: list `context/` and load by filename on demand.

## Library Docs

When working with libraries, frameworks, or APIs:

1. Fetch current official docs via context7 before answering from memory.
2. Prefer exact library matches and version-specific docs.
3. Prefer primary docs over third-party summaries.
4. Cite the relevant version when it matters.

## Skill Authoring

Hard rules for authoring skills and editing `SKILL.md` files.

- Skills are canonical for tool workflows. Keep CLAUDE.md / AGENTS.md to hard rules only.
- Editing AGENTS.md, CLAUDE.md, skills, or skill references: token-efficient, relaxed grammar, terse descriptions. See `work-style.md` shared fragment for the bar.
- Skill descriptions: short generic trigger phrase, not a summary. No personal names, long paths, or workflow narration unless required for routing.
- Skill frontmatter: quote the `description` value. After editing a `SKILL.md`, YAML-parse the frontmatter before commit.

## Code Quality Runners

Three MCP runners handle code-quality checks. Prefer them over raw CLIs; they filter output for token efficiency and return structured results.

Always pass `response_format: "json"`.

- `bun_runTests`: suite-level test run (all or filtered by pattern).
- `bun_testFile`: focused debugging on one exact file path.
- `bun_testCoverage`: coverage summary (slower than `bun_runTests`).
- `biome_lintCheck`: read-only lint + format diagnostics after edits.
- `biome_lintFix`: auto-fix with `--write`; returns remaining issues.
- `biome_formatCheck`: format compliance only (CI / pre-commit gates).
- `tsc_check`: `tsc --noEmit` using nearest tsconfig.

Do not invoke `bun test`, `biome`, or `tsc` directly via shell when these runners are available.

Exit codes: `0` success, `2` blocking error (fix before proceeding).

## Connector Dispatch

When Nathan asks about calendar events, email, or contacts, use the productivity connector system — not built-in MCP tools.

1. Read `.productivity.yml` in current project root for connector and account.
2. Read `productivity-connectors` skill for routing table and dispatch protocol.
3. Dispatch via Bash CLI (e.g., `gog` with `--account <email> --json`) or MCP tool as routing table specifies.
4. If `.productivity.yml` doesn't exist, ask which account to use.

Do not call `gcal_list_events`, `gcal_get_event`, `gmail_search_messages`, or other Google MCP tools directly.

## Email Reading

- When surfacing emails during sync or triage, read the full body and extract details (products, amounts, actions, dates).
- Never ask the user what's in an email you have access to.
- Decode base64 HTML bodies and parse contents before presenting.

## Memory OS

- Shared user-scope memory contract: `~/.config/memory/AGENTS.md`.
- Canonical docs: `~/.config/memory/docs/`.
- Canonical source in this repo: `~/code/claude-code-config/memory/`.
- `~/.config/memory` is the stable runtime path; resolves to this repo via `./install.sh`.
- `CLAUDE.md` is hot memory only — broadly relevant, high-frequency cues. Not durable storage.
- `memory/` for compact durable recall; `docs/` for full authored documents.
- Repos own operational truth; `my-second-brain` owns synthesis and promoted durable knowledge.
- Preserve provenance for imported external material when it aids retrieval or auditing.
- Prefer QMD for broad federated recall; NotebookLM for curated synthesis packs.

## Git Safety

- Never force push, hard reset, `clean -f`, or `checkout/restore .`.
- Never use `git add .` or `git add -A`; stage specific files.
- Never skip hooks except for explicit WIP checkpoint workflows.
- Use conventional commits: `type(scope): subject`.
- Check branch policy before committing; never commit directly to protected branches.
- Protected branches: `main`, `master`, any repo-configured protected branches.
- Feature branch: commit freely once Nathan has approved.
- Protected branch with branching support: create a feature branch first.
- Protected branch without branching support: stop and ask.

Git procedure docs:

- `docs/git/conventions.md`
- `docs/git/workflows.md`
- `docs/git/worktree.md`

## Communication Style

- Clear visual structure: chunks, whitespace, formatting.
- Use Mermaid for concepts, flows, trade-offs when a compact visual reduces cognitive load.
- Celebrate wins. ADHD thrives on dopamine hits (emojis ok here).
- It's ok to say "Sorry Nathan, I don't know."
- Outbound comms (Slack, Teams, email, SMS, wiki): no em/en-dashes. See `context/comms-style.md`.

## Key People

- **Melanie** → Partner ("Bestie" / "Sweetheart")
- **Levi** → Son (age 9), sole parent
- **Mum** → Lives in Sydney

## Agent skills

Applies in `claude-code-config` repo at `/Users/nathanvale/code/claude-code-config`. Other repos: prefer repo-local `docs/agents/` when present.

## Issue tracker

Issues and PRDs for `nathanvale/claude-code-config` live in GitHub Issues. See `docs/agents/issue-tracker.md`.

## Triage labels

Triage uses canonical mattpocock/skills label vocabulary. See `docs/agents/triage-labels.md`.

## Domain docs

Repo uses single-context domain doc layout. See `docs/agents/domain.md`.

