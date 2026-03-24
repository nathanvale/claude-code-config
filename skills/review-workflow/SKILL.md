---
name: review-workflow
description: Orchestrated PR and Jira review workflow. Detects ownership and routes accordingly - reports issues for own PRs, adds comments for colleague PRs. Use for code reviews.
allowed-tools: Bash(gh:*), Bash(git:*), Bash(jira:*), mcp__plugin_clipboard_clipboard__copy, AskUserQuestion, Skill
skills: jira, git
context: fork
disable-model-invocation: true
argument-hint: "<PR_NUMBER|TICKET_KEY>"
---

# Review Workflow

Orchestrated code review workflow that handles both your own PRs and colleague reviews.

## Usage

```
/review-workflow 423              # PR number
/review-workflow POS-3018         # Jira ticket (finds linked PR)
```

## Workflow

### Step 1: Detect Context & Extract Jira Ticket

```bash
# Get PR metadata (author, branch, title, body)
gh pr view NUMBER --json author,headRefName,title,body

# Get current user
gh api user --jq '.login'
```

**Ownership check:** Compare PR author with current GitHub user.

**Extract Jira ticket** from PR (in order of reliability):
```bash
# 1. From branch name (most reliable)
gh pr view NUMBER --json headRefName --jq '.headRefName' | grep -oiE 'pos-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'

# 2. From PR title
gh pr view NUMBER --json title --jq '.title' | grep -oiE 'pos-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'

# 3. From PR body/description
gh pr view NUMBER --json body --jq '.body' | grep -oiE 'pos-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'
```

**Pattern:** `POS-\d+` (case-insensitive) — extracts ticket like `POS-3018` from branch `feat/pos-3018-datagrid`

**Error handling:** If no Jira ticket found in branch, title, or body:
1. **Ask the user** for the Jira ticket number using AskUserQuestion tool
2. If user provides ticket → continue with full workflow
3. If user skips → continue with PR-only review (no Jira comment, note in output)

```
No Jira ticket found in PR #423.
Please provide the ticket number, or skip to review PR only.
```

### Step 2: Gather Information

1. **Jira ticket** — Use `/jira` skill to fetch:
   - Acceptance criteria
   - Comments
   - Parent story context

2. **PR details** — Use `/pr-review` skill to analyze:
   - Code changes
   - Test coverage
   - Potential issues

### Step 3: Route Based on Ownership

#### Own PR (author matches current user)

Report findings directly to user:
```
## Self-Review: PR #423

### Issues Found
- Thing to fix → file.ts:42
- Missing test coverage for edge case

### Ready to merge?
Not yet - address the above issues first.
```

**Do NOT:**
- Add comments to PR
- Add comments to Jira
- Generate Teams message

#### Step 3b: Update Pipeline State (own PR only)

1. Extract ticket key from PR branch
2. `Skill("ticket-state", args: "get <KEY>")`
3. If state exists:
   - If self-review found issues: no state change (you'll fix and re-review)
   - If self-review found no issues and stage is `pr_created`:
     `Skill("ticket-state", args: "advance <KEY> in_review --note 'Self-review passed, ready for team review'")`

**Non-blocking:** If ticket-state calls fail, the review output is still valid. Warn and continue.
Report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md): error `ticket_state_advance_failed`.

### Babysitter Inbox Reporting

On transient failures, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):
- `jira_comment_failed` — adding Jira comment fails
- `pr_not_found` — no PR found for the given ticket/number

#### Colleague's PR (author differs from current user)

1. **Add PR comments** — Constructive, with code examples
2. **Add Jira comment** — Brief summary notifying them of review
3. **Generate Teams message** — Copy to clipboard for manual paste

```bash
# Add Jira comment
jira issue comment add TICKET "I've reviewed PR #423 - left a few comments. Nice work overall!"
```

### Step 4: Output

For colleague reviews, generate a Teams message and copy to clipboard:

```
Hey [Name]! I've reviewed PR #423 for [TICKET].
Left a few comments - [summary of feedback].
[Positive closing note]
```

## Example Output

```
## Review Complete: PR #423 (Colleague)

**Jira:** POS-3018 - Data Grid bulk order landing page
**Author:** June Xu
**Ownership:** Colleague

### Actions Taken
- Added 3 comments to PR #423
- Added comment to POS-3018

### Teams Message (copied to clipboard)
---
Hey June! I've reviewed PR #423 for POS-3018.
Left a few comments about the totalCards calculation and status styles.
Looking great overall - nice clean implementation!
---
```

## Activity Logging

Log review events to the central activity stream after completing the review.

| When | Command |
|------|---------|
| Self-review started | `~/.claude/bin/activity-log.sh review-workflow start <KEY> ',"pr":<N>,"ownership":"own"'` |
| Self-review passed (advanced to in_review) | `~/.claude/bin/activity-log.sh review-workflow complete <KEY> ',"pr":<N>,"ownership":"own","result":"passed"'` |
| Self-review found issues | `~/.claude/bin/activity-log.sh review-workflow complete <KEY> ',"pr":<N>,"ownership":"own","result":"issues_found"'` |
| Colleague review complete | `~/.claude/bin/activity-log.sh review-workflow complete <KEY> ',"pr":<N>,"ownership":"colleague"'` |

---

## Output Contract

```
### Result
Reviewed PR #<N> for <KEY>: <action taken>.

### Context for Caller
- status: success|failed
- operation: review-workflow
- pr_number: <N>
- ticket: <KEY>
- ownership: own|colleague
- action: reported|commented|skipped
```

## Finding the PR from Jira

If given a Jira ticket, find the PR:
```bash
# Check for PR link in Jira (development panel)
jira issue view TICKET

# Or search GitHub for branch
gh pr list --head "feat/ticket-number" --json number --jq '.[0].number'
```
