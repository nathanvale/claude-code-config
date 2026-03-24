# Commit Workflow

Conventional Commits format with branch safety, auto-staging, and ticket-state hooks.

## Step 1: Branch Safety

```bash
git branch --show-current
```

If on `master` or `main`:
```
### Result
You are on `<branch>`. Commits should be on a feature branch.

### Context for Caller
- status: failed
- operation: commit
- error: on_protected_branch
```

## Step 2: Check for Changes

```bash
git status --porcelain
```

If nothing to commit (no modified, staged, or untracked files):
```
### Result
Nothing to commit — working tree clean.

### Context for Caller
- status: failed
- operation: commit
- error: nothing_to_commit
```

## Step 3: Auto-Stage if Needed

Check if anything is staged:
```bash
git diff --cached --name-only
```

If nothing staged but modified files exist:
- Stage all modified (tracked) files: `git add -u`
- Report what was staged
- Do NOT auto-stage untracked files — list them and let the user decide

If untracked files exist, ask:
```
Untracked files found:
- <file1>
- <file2>

Include these in the commit?
```

## Step 4: Analyze Changes

```bash
git diff --cached --stat
git diff --cached
```

From the diff, determine:
- **Type:** `feat` (new files/exports), `fix` (bug fix patterns), `refactor` (restructuring), `test` (test files only), `docs` (docs only), `chore` (config/build), `style` (formatting only)
- **Scope:** Primary directory/feature area changed (e.g., `orders`, `api`, `msw`, `bulk-print`, `types`)
- **Description:** Concise summary of what changed (imperative mood)

## Step 5: Format Message

Use Conventional Commits:
```
<type>(<scope>): <description>
```

**Rules (from [CONVENTIONS.md](CONVENTIONS.md)):**
- No emoji
- Lowercase description, no trailing period
- Imperative mood ("add", not "added")
- Max 72 chars subject line

If the change is complex, add a body:
```
<type>(<scope>): <description>

<body explaining the "why">
```

## Step 6: Commit

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<optional body>
EOF
)"
```

**NEVER use `--no-verify`.** If pre-commit hooks fail, fix the issue and create a NEW commit (do NOT amend).

**NEVER use `--amend`** unless the user explicitly asks.

## Step 7: ticket-state Hook

After commit succeeds:

1. Extract ticket key:
   ```bash
   git branch --show-current | grep -oiE 'pos-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'
   ```

2. If ticket found:
   a. `Skill("ticket-state", args: "get <KEY>")`
   b. If state exists and stage is `planned`:
      Ask: "First commit on <KEY>. Advance to `implementing`?"
      If yes: `Skill("ticket-state", args: "advance <KEY> implementing --note 'First commit: <message>'")`
   c. `Skill("ticket-state", args: "log <KEY> '<commit message>' --commits <sha>")`

3. If no ticket or state not found, skip silently.

**Non-blocking:** If any ticket-state call fails, the commit already succeeded. Warn and continue.
Report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md): error `ticket_state_advance_failed`.

## Step 8: Activity Logging

After commit succeeds, log to activity stream:

```bash
~/.claude/bin/activity-log.sh git commit <KEY> ',"sha":"<short>","message":"<subject>"'
```

Extract ticket key from branch (same as Step 7). If no key, omit the ticket field.

## Step 9: Output

```
### Result
Committed: `<type>(<scope>): <description>` (<sha short>)
<N> files changed, <N> insertions, <N> deletions

### Context for Caller
- status: success
- operation: commit
- sha: <full sha>
- message: <full message>
- files_changed: <N>
- insertions: <N>
- deletions: <N>
```
