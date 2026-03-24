# PR Review Workflow

Reviews GitHub pull requests with constructive, categorized feedback.

## Step 1: Fetch PR Metadata

```bash
gh pr view <NUMBER> --json number,title,author,headRefName,body,url,files,additions,deletions,changedFiles
```

Extract: title, author, branch, description, file count, lines changed.

## Step 2: Get Diff

```bash
gh pr diff <NUMBER>
```

If diff is very large (>500 lines), also get file list:
```bash
gh pr view <NUMBER> --json files --jq '.files[].path'
```

Focus on the most impactful files first.

## Step 3: Analyze Changes

Review the diff for:

**Blockers** (must fix before merge):
- Security vulnerabilities (XSS, injection, exposed secrets)
- Logic bugs (wrong conditions, missing edge cases)
- Breaking changes without migration
- Missing error handling for external calls

**Suggestions** (nice to have):
- Performance improvements
- Better naming or structure
- Missing types or type narrowing
- Test coverage gaps

**Questions** (need clarification):
- Unclear intent behind a change
- Missing context for a decision
- Potential side effects

**Praise** (what's done well):
- Clean patterns
- Good test coverage
- Thoughtful error handling

## Step 4: Format Findings

```
## PR #<N>: <title>

**Author:** <login>
**Branch:** <branch>
**Files changed:** <N> (+<additions> -<deletions>)

### Findings

**Blockers:**
- [ ] <issue> → <file>:<line>

**Suggestions:**
- [ ] <suggestion> → <file>:<line>

**Questions:**
- <question> → <file>:<line>

**Praise:**
- <positive observation>
```

## Comment Style

- Be constructive and encouraging
- No more than 1 emoji per review (use wisely, if at all)
- Provide code examples when suggesting fixes
- Explain the "why" behind suggestions
- Acknowledge good patterns
- Friendly, collaborative tone

## Line-Level Comments (for colleague PRs)

```bash
gh api repos/{owner}/{repo}/pulls/<NUMBER>/comments \
  -f body="<comment>" \
  -f path="<file>" \
  -f line=<line_number> \
  -f side=RIGHT \
  -F commit_id="$(gh pr view <NUMBER> --json headRefOid --jq '.headRefOid')"
```

## Output

```
### Result
Reviewed PR #<N>: <blockers> blockers, <suggestions> suggestions, <questions> questions.

### Context for Caller
- status: success
- operation: pr-review
- number: <N>
- blockers: <N>
- suggestions: <N>
- questions: <N>
- findings: <JSON array of {type, message, file, line}>
```

### Babysitter Inbox Reporting

If gh API line-level comment fails, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md): error `gh_api_comment_failed`.
