<!-- GENERATED — do not edit directly. Edit fragments in $HOME/code/claude-code-config/prompt-fragments/ and run: $HOME/code/claude-code-config/scripts/render-user-prompts.sh --write -->

# Nathan's Agent Preferences

- **Location** → Melbourne, Australia (AEST/AEDT)
- **ADHD** → Cognitive load is my enemy. DX matters enormously.
- **Visual learner** → Clear structure, whitespace, formatting help me process.
- **Exploratory** → I want to learn from what you do. Explain the "why."

## Working Boundaries

### Always Do

- Read relevant files before acting
- Plan explicitly for complex tasks before implementation
- Execute in small, reviewable steps
- Test each meaningful change with the appropriate checks
- Explain what you changed and why
- Document exported functions with JSDoc or comments when the why is not obvious

### Ask First

- Before implementing after an analysis-only or brainstorming request
- Before refactors that change structure beyond the requested fix
- Before commits, branch changes, or actions with non-obvious consequences
- Before defaulting to the current repo when ownership is unclear
- Before adding new dependencies — check if an existing dep or stdlib solves it

### Never Do

- Delete untracked git changes
- Implement without confirmation
- Use destructive git commands like `reset --hard`, `clean -f`, or force push
- Hardcode secrets, tokens, or API keys in source files
- Create nested `biome.json` files in monorepos
- Use generic write or edit flows for Obsidian vault content

## Workflow

Follow Plan → Confirm → Execute → Test:

1. Read the relevant code and docs first
2. Make a clear plan when the task is non-trivial
3. Confirm with Nathan before implementation
4. Execute incrementally in small chunks
5. Verify with the right checks as you go
6. Explain the result and the reasoning behind it

## Working Preferences

- For tests, lint, and type checks: **prefer the MCP runners** (bun-runner, biome-runner, tsc-runner) first. Fall back to the repo's dedicated CLI (via package.json scripts or a repo-provided wrapper) only when an MCP runner isn't available or doesn't fit the project. Use raw Bash only as the last resort.
- Prefer machine-readable output for tool-to-tool interfaces
- Prefer `bunx` over `npx` when package execution is needed
- Prefer the bun ecosystem and TypeScript over Python or other languages

## Library Docs

When working with libraries, frameworks, or APIs:

1. Fetch current official documentation with context7 before answering from memory
2. Prefer exact library matches and version-specific docs when available
3. Prefer primary docs over third-party summaries
4. Cite the relevant version when it matters

## Code Quality Runners

Three MCP runners handle all code-quality checks. Always prefer them over running the underlying CLIs directly — they filter output for token efficiency and return structured results.

**Always pass `response_format: "json"`.**

| Runner | Tool | Use when |
|--------|------|----------|
| bun-runner | `bun_runTests` | Suite-level test run (all or filtered by pattern) |
| bun-runner | `bun_testFile` | Focused debugging — one exact file path |
| bun-runner | `bun_testCoverage` | Coverage summary (slower than `bun_runTests`) |
| biome-runner | `biome_lintCheck` | Read-only lint + format diagnostics after edits |
| biome-runner | `biome_lintFix` | Auto-fix with `--write`, returns remaining issues |
| biome-runner | `biome_formatCheck` | Format compliance only (CI / pre-commit gates) |
| tsc-runner | `tsc_check` | `tsc --noEmit` using nearest tsconfig — after edits |

Do not invoke `bun test`, `biome`, or `tsc` directly via shell when these runners are available.

Exit codes: `0` = success, `2` = blocking error (must fix before proceeding).

## Connector Dispatch

When Nathan asks about calendar events, email, or contacts, use the productivity connector system — not built-in MCP tools.

1. Read `.productivity.yml` in the current project root for the declared connector and account
2. Read `productivity-connectors` skill for the routing table and dispatch protocol
3. Dispatch via Bash CLI (e.g., `gog` with `--account <email> --json`) or MCP tool as the routing table specifies
4. If `.productivity.yml` doesn't exist, ask which account to use

Do not call `gcal_list_events`, `gcal_get_event`, `gmail_search_messages`, or other Google MCP tools directly.

## Email Reading

When surfacing emails during sync or triage, always read the full email body and extract details (products, amounts, actions, dates). Never ask the user what's in an email you have access to. Decode base64 HTML bodies and parse the contents before presenting.

## Governance

### Memory OS

- Shared user-scope memory contract lives at `~/.config/memory/AGENTS.md`
- Canonical docs live under `~/.config/memory/docs/`
- Canonical source lives in this repo at `~/code/claude-code-config/memory/`
- `~/.config/memory` is the stable runtime path and should resolve to this repo via `./install.sh`
- `CLAUDE.md` is hot memory only — broadly relevant, high-frequency cues, not durable storage
- `memory/` is for compact durable recall; `docs/` is for full authored documents
- Repos own operational truth; `my-second-brain` owns synthesis and promoted durable knowledge
- Preserve provenance for imported external material when it helps future retrieval or auditing
- Prefer QMD for broad federated recall and NotebookLM for curated synthesis packs

### Git Safety

- Never force push, hard reset, clean -f, or checkout/restore `.`
- Never use `git add .` or `git add -A`; stage specific files
- Never skip hooks except for explicit WIP checkpoint workflows
- Use conventional commits: `type(scope): subject`
- Check branch policy before committing; do not commit directly to protected branches

Protected branches include `main`, `master`, and any repo-configured protected branches.

- If on a feature branch, commit freely once Nathan has approved
- If on a protected branch and the harness supports branching, create a feature branch first
- If on a protected branch and branching is not supported, stop and ask the user

For detailed git procedures, read:

- `docs/git/conventions.md`
- `docs/git/workflows.md`
- `docs/git/worktree.md`

## Communication Style

- Clear visual structure — break complex info into chunks, use whitespace and formatting
- Celebrate wins — ADHD thrives on dopamine hits (emojis ok here)
- It's ok to say "Sorry Nathan, I don't know."

## Key People

- **Melanie** → Partner ("Bestie" / "Sweetheart")
- **Levi** → Son (age 9), sole parent
- **Mum** → Lives in Sydney

### On-Demand Context Docs

Consult additional context docs when the task needs repo-specific guidance.

- `code-style.md` → TypeScript, testing, JSDoc
- `search-tools.md` → Kit plugin tool selection
- `bun-runner.md` → Test/lint MCP tools
- `atuin.md` → Shell history search
- `personal.md` → Birthdays, hobbies, details
- `personal-projects.md` → Side projects and active builds
- `learning-goals.md` → Currently learning, study goals
- `obsidian-setup.md` → PARA method, vault commands
- `hardware.md` → Monitor, Mac specs, SSH details
- `known-issues.md` → Bunx cache, git-safety hook, VS Code
- `git-workflow.md` → Git safety, conventional commits
- `contract-perel-baldwin-context.md` → Perel-Baldwin input contract, ContextBundle assembly
- `contract-people-note.md` → People-note output contract (rewrite mode)
- `contract-people-note-create.md` → People-note creation contract
- `contract-people-note-review.md` → People-note review contract
- `template-perel-baldwin-bundle.md` → ContextBundle fill-in template for Perel-Baldwin dispatch

## Codex-Specific Notes

- **Skills** → Codex discovers skills from repo `.agents/skills/` and user `$HOME/.agents/skills/`
- **Custom agents** → Codex custom agent definitions live in repo `.codex/agents/` and user `~/.codex/agents/`
- **Rules** → `~/.codex/rules/*.rules` are Starlark execution-policy rules, not behavioral prompts
- **Config** → runtime settings live in project `.codex/config.toml` and user `~/.codex/config.toml`

## Codex Context Loading

When you need one of the on-demand context docs, read the matching file from the repo-local `context/` directory.

Use this for targeted lookup, not bulk loading.

## Compound Codex Tool Mapping (Claude Compatibility)

Tool mapping:
- Read: use `rg`, `sed`, `cat`, or repo-aware retrieval tools when appropriate
- Write: use `apply_patch` for manual edits
- Edit/MultiEdit: use apply_patch
- Shell: use `exec_command` — but for tests / lint / type-check, prefer the MCP runners (`bun_runTests`, `biome_lintCheck`, `tsc_check`, etc.) over running `bun test`, `biome`, or `tsc` through `exec_command`
- Grep: use `rg` (fallback: `grep`)
- Glob: use `rg --files` or `find`
- LS: use `ls` via `exec_command`
- Web/docs research: use Context7 for library docs and web tools only when needed
- AskUserQuestion/Question: ask the user in chat
- Parallel reads/checks: use `multi_tool_use.parallel` when tasks are independent
- TodoWrite/TodoRead: use file-based todos in todos/ with file-todos skill
- Skill: open the referenced SKILL.md and follow it
- ExitPlanMode: ignore

