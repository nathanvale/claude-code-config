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
