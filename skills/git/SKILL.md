---
name: git
description: Unified git and GitHub operations. Local repo (status, log, diff, commit, branch, stash, blame, search, file-history) and GitHub PR (create, view, list, diff, checks, comment, review, merge, ready, submit-review). Composes into workflow skills.
allowed-tools: Bash(git:*), Bash(gh:*), mcp__plugin_git_git-intelligence__*, Read, Glob, AskUserQuestion, Skill
context: fork
user-invocable: true
disable-model-invocation: true
argument-hint: <operation> [args] [options]
---

# Task

Unified git and GitHub operations. Your arguments:
- **Operation:** `$0`
- **All args:** `$ARGUMENTS`

## Step 1: Parse Operation

Extract `$0` from `$ARGUMENTS`. It must be one of:

**Local git:** `status` | `log` | `diff` | `branch` | `stash` | `search` | `file-history` | `branch-create` | `blame` | `commit`
**GitHub PR:** `pr-create` | `pr-view` | `pr-list` | `pr-diff` | `pr-checks` | `pr-comment` | `pr-merge` | `pr-ready` | `pr-submit-review` | `pr-review`

If not recognized:
```
### Result
Unknown operation: "$0". See [EXAMPLES.md](EXAMPLES.md) for all 20 operations.

### Context for Caller
- status: failed
- operation: $0
- error: unknown_operation
```

## Step 2: Tool Selection

**MCP-first for reads.** Use git-intelligence MCP tools with `response_format: "json"` for all read operations. Fall back to CLI if MCP fails.

| Operation | MCP Tool | CLI Fallback |
|-----------|----------|-------------|
| `status` | `git_get_status` | `git status --porcelain` |
| `log` | `git_get_recent_commits` | `git log --oneline` |
| `diff` | `git_get_diff_summary` | `git diff` |
| `branch` | `git_get_branch_info` | `git branch -vv` |
| `stash` | `git_get_stash_list` | `git stash list` |
| `search` | `git_search_commits` | `git log --grep` |
| `file-history` | `git_get_file_history` | `git log --follow` |

**CLI-only operations:** `branch-create`, `blame`, `commit`, all `pr-*` ops.

## Step 3: Execute

### status

Use `git_get_status({ response_format: "json" })`.

**Flags:** `--porcelain` → raw porcelain output via CLI

**Output:**
```
### Result
<N> modified, <N> untracked, <N> staged files.
<file list if ≤ 20 files, otherwise summary>

### Context for Caller
- status: success
- operation: status
- modified: <N>
- untracked: <N>
- staged: <N>
```

### log

Use `git_get_recent_commits({ limit: <N>, response_format: "json" })`.

**Flags:** `--limit N` (default: 10), `--author "name"`, `--since "date"`

**Output:**
```
### Result
<commit list>

### Context for Caller
- status: success
- operation: log
- count: <N>
```

### diff

Use `git_get_diff_summary({ ref: <ref>, response_format: "json" })`.

**Flags:** `--ref <ref>` (default: working tree), `--staged`, `--stat` (summary only)

**Output:**
```
### Result
<diff summary or content>

### Context for Caller
- status: success
- operation: diff
- files_changed: <N>
```

### branch

Use `git_get_branch_info({ response_format: "json" })`.

**Flags:** `--all` (include remotes)

**Output:**
```
### Result
Current: <branch name>
<branch list>

### Context for Caller
- status: success
- operation: branch
- current: <branch>
```

### stash

Use `git_get_stash_list({ response_format: "json" })` for listing.

**Sub-operations:** `list` (default) | `push [message]` | `pop [index]` | `apply [index]` | `drop [index]`

For mutations (`push`, `pop`, `apply`, `drop`) use CLI:
```bash
git stash <sub-op> [args]
```

**Output:**
```
### Result
<stash list or operation result>

### Context for Caller
- status: success
- operation: stash
- sub_op: <sub-operation>
```

### search

Use `git_search_commits({ query: "<text>", response_format: "json" })`.

**Flags:** `--limit N` (default: 10)

**Output:**
```
### Result
<matching commits>

### Context for Caller
- status: success
- operation: search
- query: <text>
- count: <N>
```

### file-history

Use `git_get_file_history({ file_path: "<path>", response_format: "json" })`.

**Flags:** `--limit N` (default: 10)

**Output:**
```
### Result
<commit history for file>

### Context for Caller
- status: success
- operation: file-history
- file: <path>
- count: <N>
```

### branch-create

```bash
git checkout -b <branch-name>
```

**Safety:** Warn if uncommitted changes exist (run `git status --porcelain` first).

Follow naming conventions from [CONVENTIONS.md](CONVENTIONS.md).

**Output:**
```
### Result
Created and switched to branch `<name>`.

### Context for Caller
- status: success
- operation: branch-create
- branch: <name>
```

### blame

```bash
git blame <file> [-L start,end]
```

**Flags:** `--line <start>,<end>` or `-L <range>`

**Output:**
```
### Result
<blame output>

### Context for Caller
- status: success
- operation: blame
- file: <path>
```

### commit

**Complex operation — see [COMMIT.md](COMMIT.md) for full workflow.**

Conventional Commits format. Branch safety checks. Auto-stage if nothing staged.

### pr-create

**Complex operation — see [PR_CREATE.md](PR_CREATE.md) for full workflow.**

Template detection, Jira ticket extraction, Conventional Commits title.

### pr-review

**Complex operation — see [PR_REVIEW.md](PR_REVIEW.md) for full workflow.**

Categorized findings: blockers, suggestions, questions, praise.

### pr-view

```bash
gh pr view <NUMBER> --json number,title,state,author,headRefName,body,url,reviews,reviewDecision,mergeable,statusCheckRollup
```

**Output:**
```
### Result
**PR #<N>: <title>**
- Author: <login>
- State: <state>
- Branch: <branch>
- Review: <reviewDecision or "Pending">
- Mergeable: <mergeable>
- Checks: <pass/fail/pending>

### Context for Caller
- status: success
- operation: pr-view
- number: <N>
- title: <title>
- state: <state>
- author: <login>
- branch: <branch>
- url: <url>
- review_decision: <decision>
- mergeable: <bool>
```

### pr-list

```bash
gh pr list [--state open|closed|merged|all] [--author @me] [--limit N] --json number,title,state,headRefName,author,url
```

**Flags:** `--state` (default: open), `--author`, `--limit` (default: 10)

**Output:**
```
### Result
| # | Title | State | Branch | Author |
|---|-------|-------|--------|--------|
<rows>

### Context for Caller
- status: success
- operation: pr-list
- count: <N>
```

### pr-diff

```bash
gh pr diff <NUMBER>
```

**Output:** Full diff content with Context for Caller.

### pr-checks

```bash
gh pr checks <NUMBER> --json name,state,conclusion
```

**Output:**
```
### Result
| Check | Status | Conclusion |
|-------|--------|------------|
<rows>

### Context for Caller
- status: success
- operation: pr-checks
- number: <N>
- passing: <N>
- failing: <N>
- pending: <N>
```

### pr-comment

```bash
gh pr comment <NUMBER> --body "<text>"
```

**Output:**
```
### Result
Comment added to PR #<N>.

### Context for Caller
- status: success
- operation: pr-comment
- number: <N>
```

### pr-merge

```bash
gh pr merge <NUMBER> [--merge|--squash|--rebase] [--delete-branch]
```

**Default:** `--squash --delete-branch`

**Safety:** Confirm with user before merging. Check that PR is approved and checks pass.

**ticket-state hook** (after successful merge):
1. Extract ticket key: `git branch --show-current | grep -oiE 'pos-[0-9]+' | head -1`
2. If ticket found:
   a. `Skill("ticket-state", args: "get <KEY>")`
   b. If state exists and stage is not `merged`:
      `Skill("ticket-state", args: "advance <KEY> merged --note 'PR #<number> merged'")`
3. If no ticket or state not found, skip silently.

**Output:**
```
### Result
PR #<N> merged via <strategy>.

### Context for Caller
- status: success
- operation: pr-merge
- number: <N>
- strategy: <merge|squash|rebase>
```

### pr-ready

```bash
gh pr ready <NUMBER>
```

**Output:**
```
### Result
PR #<N> marked as ready for review.

### Context for Caller
- status: success
- operation: pr-ready
- number: <N>
```

### pr-submit-review

```bash
gh pr review <NUMBER> --approve|--request-changes|--comment [--body "text"]
```

**Flags:** `--approve`, `--request-changes`, `--comment`, `--body "text"`

**Output:**
```
### Result
Review submitted on PR #<N>: <type>.

### Context for Caller
- status: success
- operation: pr-submit-review
- number: <N>
- review_type: <approve|request-changes|comment>
```

## Step 4: Structured Output

Every operation MUST return:
```
### Result
<human-readable summary>

### Context for Caller
- status: success|failed
- operation: <operation>
- <operation-specific fields>
```

## Activity Logging

Log significant git operations to the central activity stream:

```bash
~/.claude/bin/activity-log.sh git <op> <KEY> [extra]
```

**When to log:**

| Operation | Log? | Extra Fields |
|-----------|------|--------------|
| `commit` | Yes | `,"sha":"<short>","message":"<subject>"` |
| `pr-create` | Yes | `,"pr":<number>,"url":"<url>"` |
| `pr-merge` | Yes | `,"pr":<number>,"strategy":"<squash\|merge\|rebase>"` |
| Read operations | No | — |

**Example:**
```bash
~/.claude/bin/activity-log.sh git commit POS-3243 ',"sha":"abc123f","message":"feat(msw): add seller mock data"'
~/.claude/bin/activity-log.sh git pr-create POS-3243 ',"pr":446,"url":"https://github.com/.../pull/446"'
~/.claude/bin/activity-log.sh git pr-merge POS-3243 ',"pr":446,"strategy":"squash"'
```

## Reference

- [COMMIT.md](COMMIT.md) — Conventional Commits workflow
- [PR_CREATE.md](PR_CREATE.md) — PR creation with template compliance
- [PR_REVIEW.md](PR_REVIEW.md) — PR review process
- [CONVENTIONS.md](CONVENTIONS.md) — Branch naming, safety rules
- [EXAMPLES.md](EXAMPLES.md) — Quick reference for all operations
