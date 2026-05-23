# Pre-flight checks (shared)

Every subcommand runs this protocol before doing anything else. The
checks are the same; only the per-subcommand strictness differs (noted
below per check).

## Severity ladder

| Severity | What happens |
| --- | --- |
| **blocker** | Stop immediately. Print the failing check and a one-line fix suggestion. Do not run the subcommand. |
| **warn** | Print the warning, ask the user `Continue? [y/n]`. On `n`, stop. On `y`, run the subcommand. |
| **info** | Silent. Only surface if `--verbose` is passed (orchestrator does not implement `--verbose` yet; reserved). |

## Resolution order

Run checks in this order. Stop at the first **blocker**. Accumulate
**warns** and present them as a single confirmation block before running
the subcommand.

### 1. Resolve `area-path`

**Inputs:** the user's first non-keyword positional argument, OR
auto-discovery.

**Auto-discovery** (when no `area-path` was provided):

Scan both repo-scope and user-scope locations:

```bash
find docs/runbooks -maxdepth 2 -name "README.md" -type f 2>/dev/null
find "$HOME/.claude/runbooks" -maxdepth 2 -name "README.md" -type f 2>/dev/null
```

Repo-scope (`docs/runbooks/*/`) holds runbooks tied to a specific
codebase. User-scope (`~/.claude/runbooks/*/`) holds host-neutral
workflow runbooks that operate on a *target* repo passed in at launch
(for example, `issue-to-pr-v2`). Both follow the same convention; only
the path differs.

Possible outcomes:

| Outcome | Severity | Action |
| --- | --- | --- |
| Exactly one match | info | Use it as `area-path`, surface the choice in the output header |
| Multiple matches | blocker | List them (label each as repo-scope or user-scope), ask the user to pick. Do not auto-pick. |
| Zero matches | blocker | "No runbook areas found at `docs/runbooks/*/README.md` or `~/.claude/runbooks/*/README.md`. Pass an explicit path or create one with `/runbook-orchestrator new`." |

**Explicit path:**

| Outcome | Severity | Action |
| --- | --- | --- |
| Path resolves and is a directory | info | continue |
| Path resolves but is a file | blocker | "Expected directory, got file: `<path>`" |
| Path does not resolve | blocker | "No such directory: `<path>`. Tip: paths are relative to CWD; current CWD is `<cwd>`." |
| Path is outside the current git repo | warn | "Area is outside this repo. Cross-repo runbooks are unusual; typo?" |

### 2. README presence and parseability

**Required:** `<area-path>/README.md` exists.

| Outcome | Severity per subcommand | Action |
| --- | --- | --- |
| File exists | info | continue |
| File missing | **status/launch/audit/report**: blocker. **new**: warn → routes to recovery/bootstrap flow in [new-seam.md](new-seam.md). | For blocker: "Missing `<area-path>/README.md`. Run `/runbook-orchestrator new <area-path>` to bootstrap or recover the README." |

The `new` subcommand owns README recovery and area bootstrap. Other
subcommands cannot function without a parseable README and stay strict.

**Required:** README contains a parseable seam table.

Look for `## Why these seams` (or any `## ...seams` heading) followed by
at least one markdown table with the columns
`| Seam | Runbook | Ledger | Files |`.

| Outcome | Severity | Action |
| --- | --- | --- |
| Seam table found and parseable | info | continue |
| Section heading present, no table | blocker | "README has the seams section but no parseable seam table. See [convention.md](convention.md)." |
| Section heading missing | blocker | "README is missing the `## Why these seams` section. See [convention.md](convention.md)." |
| Table present but column headers wrong | blocker | "Seam table has wrong column headers. Expected: `Seam | Runbook | Ledger | Files`." |

### 3. Seam pair existence

For each row in the seam table:

- Check `<area-path>/<seam>.md` exists
- Check `<area-path>/<seam>-ledger.md` exists

| Outcome | Severity per subcommand | Action |
| --- | --- | --- |
| All pairs exist | info | continue |
| Some pairs missing | **launch**: blocker, **status/audit**: warn, **new**: info | Print the missing files, ask the user to confirm before continuing (for warn) |

`launch` blocks because it can't dispatch a missing runbook. `status` and
`audit` continue with a warning - they should still report the state of
the pairs that exist. `new` does not care, since it may be creating one
of the missing pairs.

### 4. Git availability

Run `git rev-parse --git-dir` quietly.

| Outcome | Severity per subcommand | Action |
| --- | --- | --- |
| Inside a git repo | info | continue |
| Not a git repo OR git not on PATH | **audit**: warn ("ledger drift check will be skipped"), **launch**: warn ("commits won't be tracked"), **status/new**: info | Continue |

The orchestrator does not require git, but several checks degrade without
it.

### 5. Working-tree cleanliness (launch only)

Only relevant for `launch`. Skip for `status`, `new`, `audit`.

Run `git status --porcelain` and count modified / untracked files
relative to `<area-path>` and the seam's files-in-scope.

| Outcome | Severity | Action |
| --- | --- | --- |
| Tree clean | info | continue |
| Modified files in seam scope | warn | "Working tree has uncommitted changes in the seam's files-in-scope. The implementer agent will commit on top of these changes, mixing your WIP with autonomous fixes." |
| Modified files outside seam scope | info | continue (irrelevant) |
| Untracked files in seam scope | info | continue (untracked won't be staged by the agent unless the agent explicitly adds them) |

### 6. `/goal` availability

Cannot reliably detect from inside a skill. The skill does not query
Claude Code version.

Action: always include a `/loop` fallback line in the `launch` output,
even when assuming `/goal` is available. The user picks. This is info,
never blocker.

### 7. Subcommand-specific pre-flight

Each subcommand may add its own checks **after** the shared ones above.
These live in the subcommand's own reference doc, not here.

| Subcommand | Additional pre-flight |
| --- | --- |
| `status` | none |
| `launch` | (see launch.md - validate `seam-name` matches a row in the seam table) |
| `new` | (see new-seam.md - ensure user has provided or will provide a hotspot description) |
| `audit` | none |

## Output format for blockers

When pre-flight aborts, print this and stop:

```
# Pre-flight blocked

**Check:** <which check failed>
**Reason:** <one-line summary>

## Fix

<one-line actionable suggestion>

## Pre-flight checklist

- [x] Resolve area-path
- [x] README presence
- [ ] Seam table parseable  <- blocker here
- [ ] Seam pairs
- [ ] Git available
- [ ] Working-tree clean (launch only)

Re-run after fixing.
```

## Output format for warnings

When pre-flight has warnings only, accumulate and present once:

```
# Pre-flight warnings (<count>)

1. **Working tree not clean.** You have 3 modified files in the seam's
   scope (`selection/useTableSelection.ts`, `selection/index.ts`,
   `__tests__/.../useTableSelection.test.tsx`). The implementer agent
   will commit on top of these.

2. **Area is outside this repo.** `<area-path>` resolves to
   `/Users/nathan/other-repo/docs/runbooks/foo`. Cross-repo runbook?

Continue? [y/n]
```

On `y`: print the subcommand output. On `n`: print "Pre-flight aborted
by user." and stop.

## What pre-flight does NOT do

- It does not modify any file.
- It does not run `git` operations beyond read-only checks
  (`rev-parse`, `status --porcelain`, `cat-file -e`).
- It does not validate ledger contents - that's `audit`'s job.
- It does not validate `/goal` syntax - that's the user's responsibility
  when they paste the invocation.
- It does not check whether a `/goal` is already active in another
  session - it cannot see other sessions' state.

## Implementation note

The shared pre-flight runs at the **top** of each subcommand. The
subcommand reference files start their protocol with:

```
## Pre-flight

Run [pre-flight checks](preflight.md) first. Abort on blocker; prompt on
warning.
```

This keeps the per-subcommand references focused on their own protocol
and avoids duplicating the pre-flight checklist.
