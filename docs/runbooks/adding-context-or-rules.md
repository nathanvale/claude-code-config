---
title: "Adding Context Files or Rules"
type: runbook
status: active
updated: 2026-03-22
summary: "Step-by-step: add a new context file or auto-applied rule, including the check updates needed."
---

# Runbook: Adding Context Files or Rules

## Adding a Context File

Context files live in `context/` and are symlinked to `~/.claude/context/`. They're loaded on-demand when Claude invokes `@~/.claude/context/filename.md`.

### Steps

1. **Create the file:**
   ```bash
   # e.g., context/docker-setup.md
   ```

2. **Add to the context file index** in `prompt-fragments/shared/memory-os.md`:
   ```markdown
   - `~/.claude/context/docker-setup.md` → Docker config, compose patterns
   ```
   This is required — the `--check` validates that every path listed here resolves to an actual file.

3. **Re-render:**
   ```bash
   ./scripts/render-user-prompts.sh --write
   ./scripts/render-user-prompts.sh --check
   ```

4. **Verify** the context check passes — it confirms the new file exists at the symlinked path.

### Janitor note

The context file existence check in `--check` reads paths from `prompt-fragments/shared/memory-os.md`. If you add a context file but don't add it to the index, the orphan won't be caught. If you add it to the index but don't create the file, `--check` will catch it.

---

## Adding a Rule

Rules live in `rules/` and are symlinked to `~/.claude/rules/`. Rules with `alwaysApply: true` are loaded every Claude session automatically.

### Steps

1. **Create the rule file** with frontmatter:
   ```markdown
   ---
   alwaysApply: true
   ---

   Your rule content here.
   ```

2. **That's it.** Since `~/.claude/rules/` is symlinked to `$REPO/rules/`, the new rule is immediately available to Claude.

3. **No render step needed** — rules are not part of the fragment/render pipeline. They're standalone files auto-loaded by Claude Code.

### When to use `alwaysApply: true` vs `false`

- `true` — the rule should govern every session (tool routing, safety, governance)
- `false` — the rule is situational and Claude should decide when it's relevant

### Known limitation

`paths:` frontmatter (conditional loading by file pattern) does **not work** at user scope (`~/.claude/rules/`). It only works at project scope. See Issue #21858. All user-scope rules should use `alwaysApply: true` or `false`.

### Codex note

Codex doesn't read `rules/`. If a rule contains guidance Codex also needs, add that content to `prompt-fragments/shared/` so it appears in the Codex AGENTS.md output.
