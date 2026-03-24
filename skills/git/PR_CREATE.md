# PR Creation Workflow

Create a pull request using the repository's GitHub PR template, with ticket-state integration.

## Step 1: Gather Context

```bash
# Get current branch
git branch --show-current

# Get base branch (usually master or main)
git remote show origin | grep 'HEAD branch' | cut -d' ' -f5

# See all commits since diverging from base
git log master..HEAD --oneline

# See files changed
git diff master...HEAD --stat

# Extract Jira ticket from branch name
git branch --show-current | grep -oiE '(pos|ferns)-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'
```

**Validations:**
- If no commits → error: "Nothing to create PR for."
- If already on master/main → error: "Cannot create PR from protected branch."
- Check for existing PR: `gh pr list --head <branch> --json number,url --limit 1`
  - If PR exists → show URL: "PR already exists: #<N> (<url>)"
  - **Still run ticket-state hook:** Even though we didn't create the PR, ensure pipeline state is current:
    1. Extract ticket key from branch name
    2. If ticket found: `Skill("ticket-state", args: "get <KEY>")`
    3. If state exists and stage is before `pr_created`:
       `Skill("ticket-state", args: "advance <KEY> pr_created --note 'PR #<number> already exists — syncing state'")`
    4. Update PR metadata: `Skill("ticket-state", args: "update <KEY> --pr-url <url> --pr-number <number>")`
    5. Return with `status: success` (not `failed`) since the PR exists and state is synced
  - **Output for existing PR:**
    ```
    ### Result
    PR already exists: #<N> (<url>)
    Pipeline state synced to `pr_created`.

    ### Context for Caller
    - status: success
    - operation: pr-create
    - number: <N>
    - url: <url>
    - existing: true
    - ticket: <KEY or null>
    - state_synced: true
    ```
- **QA verification gate:** If ticket state exists and stage is before `qa_verified` (index < 4):
  ```
  AskUserQuestion:
    question: "QA verification not complete. Run `/qa-test <KEY>` first?"
    header: "QA Gate"
    options:
      - "Run /qa-test first" / "Abort PR creation and run QA verification"
      - "Create PR (skip QA)" / "Skip QA gate — this PR doesn't need browser verification (docs, config, etc.)"
  ```
  If "Run /qa-test first": output "Run `/qa-test <KEY>` to verify ACs in browser." **Stop.**
  If "Create PR (skip QA)": log warning to babysitter inbox:
  ```bash
  echo '{"at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","skill":"git","error":"qa_gate_skipped","message":"PR created without QA verification for <KEY>","ticket":"<KEY>"}' >> ~/.claude/state/babysitter/inbox.ndjson
  ```
  Continue with PR creation.

## Step 2: Load PR Template

Check for GitHub PR template (in order of precedence):
1. `.github/PULL_REQUEST_TEMPLATE.md`
2. `PULL_REQUEST_TEMPLATE.md`
3. `docs/PULL_REQUEST_TEMPLATE.md`

```bash
for f in .github/PULL_REQUEST_TEMPLATE.md PULL_REQUEST_TEMPLATE.md docs/PULL_REQUEST_TEMPLATE.md; do
  [ -f "$f" ] && echo "$f" && break
done
```

**If template exists:** Read it with the Read tool and use it as the **exact skeleton** for the PR body.

**STRICT TEMPLATE RULES:**
1. **Read the template file first** — Do NOT skip this step or assume you know the format
2. **Use the template verbatim as your starting point** — Copy its structure exactly
3. **Only replace placeholder text** — Keep all headings, separators, tables, and checkbox lists intact
4. **Fill in EVERY section** — Do not omit sections even if they seem optional
5. **Preserve formatting exactly** — Same heading levels, same table columns, same checkbox format

**What to replace:**
- `{Summary...}` or `{Description...}` → Generated summary from commits
- `FERNS-1234` or placeholder ticket IDs → Actual Jira ticket from branch name
- `[ ]` checkboxes → Mark with `[x]` based on change type

**What to keep unchanged:**
- All section headings
- All separators (`---`)
- Table structure and column headers
- Checkbox option text (just change `[ ]` to `[x]`)

**You may ADD extra sections** (e.g., `## Changes`, `## Test plan`) after the template sections.

**If no template:** Use a minimal format:
```markdown
## Summary
{Generated summary}

## Jira
[{TICKET}](https://bunnings.atlassian.net/browse/{TICKET})
```

## Step 3: Generate PR Title

Use Conventional Commits format based on change type:
- `feat(scope): description` — New features
- `fix(scope): description` — Bug fixes
- `refactor(scope): description` — Refactoring
- `docs(scope): description` — Documentation
- `test(scope): description` — Test changes
- `chore(scope): description` — Maintenance

**Scope:** Infer from the primary directory changed (e.g., `msw`, `api`, `orders`)

**Phase-Aware Titles:** For multi-phase tickets, use phase-appropriate prefixes:
- `impl` phase: `feat(scope): ...` or `fix(scope): ...` (based on work type)
- `test` phase: `test(scope): add Cypress tests for POS-XXXX`
- `fix` phase: `fix(scope): ...`
- `docs` phase: `docs(scope): ...`

Detect phase from branch prefix (`test/POS-*` → test phase) and use the corresponding commit type.

## Step 4: Create the PR

```bash
# Push branch if needed
git push -u origin HEAD

# Create PR with HEREDOC for body formatting
gh pr create --title "feat(scope): description" --body "$(cat <<'EOF'
{filled template}
EOF
)"
```

## Step 5: Return PR URL

Output the PR URL so the user can access it.

## Step 6: ticket-state Hook

After successful PR creation:

1. Extract ticket key from branch:
   ```bash
   git branch --show-current | grep -oiE 'pos-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'
   ```

2. If ticket found:
   a. `Skill("ticket-state", args: "get <KEY>")`
   b. If state exists and stage is before `pr_created`:
      `Skill("ticket-state", args: "advance <KEY> pr_created --note 'PR #<number> created'")`
   c. `Skill("ticket-state", args: "update <KEY> --pr-url <url> --pr-number <number>")`
   d. `Skill("ticket-state", args: "log <KEY> 'Created PR #<number>' --commits <HEAD_SHA>")`

3. If no ticket or state not found, skip silently.

**Non-blocking:** If any ticket-state call fails, the PR already exists. Warn and continue.
Report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md): error `ticket_state_advance_failed`.

## Output

```
### Result
Created PR #<N>: <title>
<url>

### Context for Caller
- status: success
- operation: pr-create
- number: <N>
- url: <url>
- title: <title>
- branch: <branch>
- base: <base branch>
- ticket: <ticket key or null>
```

## Error Handling

| Scenario | Handling |
|----------|---------|
| No commits | Error — nothing to create PR for |
| Already has PR | Show existing PR URL, sync ticket-state to `pr_created` |
| Not on feature branch | Warn if on master/main |
| No Jira ticket found | Ask user for ticket number via AskUserQuestion |
| Push fails | Show error, suggest `git pull --rebase origin <branch>` |
| Template not found | Use minimal format |

### Activity Logging

After PR creation (new or existing), log to activity stream:

```bash
~/.claude/bin/activity-log.sh git pr-create <KEY> ',"pr":<number>,"url":"<url>"'
```

Extract ticket key from branch. If no key, omit the ticket field.

### Babysitter Inbox Reporting

On transient failures, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):
- `ticket_state_advance_failed` — ticket-state call fails after PR creation
- `gh_cli_failed` — `gh pr create` or `git push` fails
