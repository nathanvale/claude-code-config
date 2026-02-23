---
description: Create a new Bun TypeScript project from template in ~/code
argument-hint: <project-name> [description]
allowed-tools: Bash(gh:*), Bash(cd:*), Bash(bun:*)
model: claude-3-5-haiku-20241022
---

Create a new project using my Bun TypeScript template (fully automated, no prompts):

1. Create repo from template and clone to ~/code:
   ```bash
   gh repo create nathanvale/$1 --template nathanvale/bun-typescript-starter --public --clone -- ~/code/$1
   ```

2. Run setup with all CLI params (--yes skips all confirmations):
   ```bash
   cd ~/code/$1 && bun run setup -- --name "@nathanvale/$1" --description "${2:-A TypeScript library}" --author "Nathan Vale" --yes
   ```

3. Remind user to set NPM_TOKEN secret if they want to publish:
   ```bash
   gh secret set NPM_TOKEN --repo nathanvale/$1
   ```

Project name: $1
Description: $2 (defaults to "A TypeScript library" if not provided)

IMPORTANT: Run all commands without asking questions. The --yes flag handles all confirmations.
