---
name: issue-to-pr
description: Drive one GitHub issue to a PR using the v2 hot router. Use when the user says "ship issue #N", "drive issue-to-pr for #N", "open a PR for issue #N", "/issue-to-pr <N>", or any request to take a specific GitHub issue end-to-end through plan, build, validate, and ship via the per-issue ledger workflow. Defers all workflow prose, ledger schema, route ids, and Builder/Validator contracts to the v2 hot router and references; this skill is a thin entrypoint only.
argument-hint: <issue-number> [target-repo]
user-invocable: true
---

# /issue-to-pr

Thin entrypoint for the v2 issue-to-pr workflow. The hot router at
`~/.claude/runbooks/issue-to-pr-v2/issue-to-pr.md` owns every workflow
detail; this skill only constructs the `/goal` invocation that points
the current agent at it.

## Usage

```
/issue-to-pr <issue-number> [target-repo]
```

- `<issue-number>` (required) — the GitHub issue number to drive
- `[target-repo]` (optional) — `owner/repo` form; defaults to the
  current repo

## Dispatch

Emit a `/goal` invocation in this shape. Substitute `{issue-number}`
and `{target-repo}` from the arguments; if `{target-repo}` was not
supplied, omit the "Target issue is in" line and let the agent infer
the current repo.

```
/goal Follow ~/.claude/runbooks/issue-to-pr-v2/issue-to-pr.md.
Target issue is {issue-number} in {target-repo}.
Re-read the runbook AND the per-issue ledger at
docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md
at the start of every turn.
```

The hot router owns the Start every turn protocol, all stage
definitions, Builder/Validator/Proposer dispatch, ledger schema, route
ids, error codes, packet roles, and links to references at
`runbooks/issue-to-pr-v2/references/` and templates at
`runbooks/issue-to-pr-v2/templates/`. Maintainer context lives in the
v2 README at `~/.claude/runbooks/issue-to-pr-v2/README.md`.

## Out of scope

- No duplication of workflow prose, ledger schema, route ids, error
  codes, or packet roles — those are owned by the hot router and
  references.
- No sub-agent dispatch; the current agent picks up the `/goal`
  invocation and drives the hot router directly.
- v1 runbook (`runbooks/issue-to-pr/`) is not wrapped. v1 stays as the
  frozen behaviour baseline.
- CI watch and post-PR review feedback are downstream of the hot
  router and have their own skills (e.g.
  `/compound-engineering:ce-resolve-pr-feedback`).
