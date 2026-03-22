---
title: "Adding a New Harness"
type: runbook
status: active
updated: 2026-03-22
summary: "Step-by-step: add support for a new AI coding tool (Gemini CLI, Cursor, VS Code Copilot, etc.)"
---

# Runbook: Adding a New Harness

## When to use

You want Claude Code config to also manage instructions for a new AI coding tool (e.g., Gemini CLI, Cursor, VS Code Copilot).

## Steps

### 1. Create the fragment directory

```bash
mkdir -p prompt-fragments/<harness-name>/
```

### 2. Create harness-specific fragments

Add any runtime notes specific to this tool:

```bash
# e.g., prompt-fragments/gemini/gemini-runtime-notes.md
```

Only add content that's unique to this harness. Shared content already exists in `prompt-fragments/shared/`.

### 3. Wire into the render script

Edit `scripts/render-user-prompts.sh`:

1. Add a fragment array:
   ```bash
   GEMINI_FRAGMENTS=(
     "gemini/gemini-runtime-notes.md"
   )
   ```

2. Add a render function:
   ```bash
   render_gemini() {
     for frag in "${SHARED_FRAGMENTS[@]}"; do
       cat "${FRAGMENTS}/${frag}"
       echo ""
     done
     for frag in "${GEMINI_FRAGMENTS[@]}"; do
       cat "${FRAGMENTS}/${frag}"
       echo ""
     done
   }
   ```

3. Add to `write_outputs()`:
   ```bash
   echo "Rendering generated/gemini-user-instructions.md..."
   render_gemini > "${SCRIPT_DIR}/generated/gemini-user-instructions.md"
   ```

4. Add to `check_outputs()` — similar pattern to the Codex check.

### 4. Add to install.sh (if symlinkable)

If the tool reads from a known config path (like `~/.gemini/AGENTS.md`), add a symlink or copy step to `install.sh`.

### 5. Render and verify

```bash
./scripts/render-user-prompts.sh --write
./scripts/render-user-prompts.sh --check
```

### 6. Test

Open the new tool and verify it loads the instructions.
