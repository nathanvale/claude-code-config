---
name: new-bun-project
description: Create a new Bun TypeScript project from template (fully automated)
argument-hint: "<project-name> [description]"
---

# New Bun TypeScript Project

Create a new project from the `nathanvale/bun-typescript-starter` template, fully automated with no interactive prompts.

**Arguments:**
- `$1` - Project name (required)
- `$2` - Description (optional, defaults to "A TypeScript library")

## Steps

### Step 1: Create repo from template and clone

```bash
gh repo create nathanvale/$1 --template nathanvale/bun-typescript-starter --public --clone -- ~/code/$1
```

Wait for the command to complete before proceeding. If it fails because the repo already exists, stop and inform the user.

### Step 2: Run project setup

```bash
cd ~/code/$1 && bun run setup -- --name "@nathanvale/$1" --description "${2:-A TypeScript library}" --author "Nathan Vale" --yes
```

The `--yes` flag skips all confirmations. Do NOT prompt the user for any input during setup.

### Step 3: Remind about NPM_TOKEN

After setup completes, tell the user:

> Project created at `~/code/$1`. If you want to publish to npm, set your NPM_TOKEN secret:
> ```bash
> gh secret set NPM_TOKEN --repo nathanvale/$1
> ```

Do NOT run the `gh secret set` command automatically -- it requires interactive input from the user.

## Important

- Run all commands without asking questions
- Do NOT add any extra steps beyond what is listed above
- Do NOT modify any files after setup completes
- If any step fails, stop and report the error
