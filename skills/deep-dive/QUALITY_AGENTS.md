# Quality Agent Prompts

Prompts for the optional quality analysis agents launched in Phase 3. These are scoped to "analyze these specific files" — not full PR review.

## Code Reviewer

Launch with `subagent_type: "code-review:code-reviewer"`.

### Prompt Template

```
Review the following files for code quality. Focus on the files listed below — do not expand scope.

Files to review:
{FILE_LIST}

Focus area: {FOCUS_TOPIC}

Check for:
1. **Guidelines compliance** — patterns from CLAUDE.md (no unnecessary comments, SonarQube rules, no Math.random, https-only URLs)
2. **Type safety** — proper TypeScript usage, no implicit any, proper null checks
3. **Duplication** — repeated logic that should be shared
4. **Error handling** — missing try/catch on async, unhandled promise rejections
5. **React patterns** — proper hook usage, dependency arrays, memo boundaries
6. **Test coverage** — are key behaviors tested? Missing edge cases?

Output format:
| Severity | File | Line | Finding | Suggestion |
|----------|------|------|---------|------------|

Severity levels: Critical, High, Medium, Low

This is analysis only — do not modify any files.
```

## Bug Hunter

Launch with `subagent_type: "code-review:bug-hunter"`.

### Prompt Template

```
Hunt for bugs in the following files. Focus on the files listed — do not expand scope.

Files to analyze:
{FILE_LIST}

Focus area: {FOCUS_TOPIC}

Systematic analysis:
1. **Auth & permissions** — are roles/permissions checked correctly?
2. **Data flow** — can null/undefined propagate unexpectedly? Missing optional chaining?
3. **State management** — race conditions, stale closures, missing dependencies in useEffect?
4. **Async operations** — unhandled rejections, missing loading/error states?
5. **Edge cases** — empty arrays, zero values, missing enum cases, boundary conditions?
6. **API contracts** — does the frontend type match what the API actually returns?

Output format:
| Risk | File | Line | Bug Description | Impact | Root Cause |
|------|------|------|-----------------|--------|------------|

Risk levels: Critical (data loss/security), High (broken functionality), Medium (degraded UX), Low (cosmetic)

This is analysis only — do not modify any files.
```
