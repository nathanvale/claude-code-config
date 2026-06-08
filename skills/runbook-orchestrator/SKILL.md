---
name: runbook-orchestrator
description: "Orchestrate iterative code-review runbooks driven by /goal. Status, launch, new (via /ce-brainstorm), or audit. Works on any folder following the README.md + seam.md + seam-ledger.md convention."
role: control-plane
argument-hint: "[status|launch|new|audit|report] [area-path] [seam-name|--all]"
disable-model-invocation: true
allowed-tools: [Read, Edit, Write, Glob, Grep, "Bash(find:*)", "Bash(git rev-parse:*)", "Bash(git status:*)", "Bash(git cat-file:*)", "Bash(git log:*)"]
---

# Runbook Orchestrator

A meta-tool for managing a folder of iterative `/goal`-driven code-review
runbooks. Knows nothing about a specific kit - works on any runbook area
that follows the convention.

For the runbook convention this skill expects, see [convention.md](references/convention.md).

## Dependencies

- `references/preflight.md`: bundled reference, hard dependency.
- `references/convention.md`: bundled reference, hard dependency.
- `/ce-brainstorm`: optional handoff for `new` add-seam flow.
- `skills/improve-codebase-architecture/SKILL.md`: optional handoff for bootstrap and report tightness passes.
- Missing bundled reference: blocked.
- Missing `/ce-brainstorm`: degraded; draft the seam prompt and ask the user to run the brainstorm manually.
- Missing `improve-codebase-architecture`: degraded for `status`, `launch`, and `audit`; blocked for bootstrap or report tightness pass.

## Quick start

```
/runbook-orchestrator status docs/runbooks/data-table-review
/runbook-orchestrator launch docs/runbooks/data-table-review header-adapter
/runbook-orchestrator new docs/runbooks/data-table-review
/runbook-orchestrator audit docs/runbooks/data-table-review
```

If no `area-path` is given, the skill scans both the current working
directory for `docs/runbooks/*/README.md` (repo-scope) and
`~/.claude/runbooks/*/README.md` (user-scope), and asks the user to
pick. User-scope holds host-neutral workflow runbooks like
`issue-to-pr-v2` that operate on a target repo passed in at launch.

## Arguments

The first positional argument selects the subcommand: `status`,
`launch`, `new`, `audit`, or `report`. If the first argument is not
one of these keywords, treat it as `status` and pass the whole argument
string as the `area-path`.

See `## Subcommand dispatch` below for what each one does, and the
linked reference files for full protocols.

## Pre-flight checks (shared)

Every subcommand runs the same pre-flight protocol **before** doing any
work. See [preflight.md](references/preflight.md) for the full check list.

Summary:

| Severity | Behaviour |
| --- | --- |
| **blocker** | Abort. Print the failing check and a fix suggestion. |
| **warn** | Accumulate, print once, ask `Continue? [y/n]`. |
| **info** | Silent. |

The shared checks are:

1. Resolve `area-path` (auto-discovery if not given)
2. README presence and parseability
3. Seam pair existence (`<seam>.md` + `<seam>-ledger.md`)
4. Git availability (warn-degraded if missing)
5. Working-tree cleanliness (`launch` only)
6. `/goal` availability (always offer `/loop` fallback)

Subcommand-specific pre-flight runs after the shared block - see the
subcommand reference files.

## Subcommand dispatch

Each subcommand is a one-line entry; the reference file is the source
of truth. SKILL.md navigates, references contain the protocol.

- **`status`** - Read every ledger, classify each seam, recommend next.
  Full protocol: [status.md](references/status.md).
- **`launch <seam>`** - Pull the seam's `/goal` invocation from the
  area's README, resolve substitution sites, print for the user to
  paste. Full protocol: [launch.md](references/launch.md).
- **`new`** - Three flows routed by disk state:
  - **Add seam** (default) - existing area + README: dispatch
    `/ce-brainstorm`, stub a new seam runbook + ledger
  - **Recover README** - area exists with seam pairs but README is
    missing: draft a fresh README from detected pairs
  - **Bootstrap area** - area-path missing or empty: dispatch
    `/improve-codebase-architecture` to suggest seams, stub
    README + first seam files

  Full protocol: [new-seam.md](references/new-seam.md). Template:
  [readme-template.md](references/readme-template.md).
- **`audit`** - 10 health checks across the area: missing files,
  rewritten commits, duplicate signatures, ADR drift, convention
  adherence. Read-only; reports only.
  Full protocol: [audit.md](references/audit.md).
- **`report <seam>`** - Closing report for a converged seam. Combines
  ledger summary + git commit log + a tightness assessment dispatched
  via `improve-codebase-architecture`. Writes
  `<seam>-report-<date>.md`. Manual or inline (runbook-driven). Full
  protocol: [report.md](references/report.md).

## Examples

### Check status on a known area

```
/runbook-orchestrator status docs/runbooks/data-table-review
```

Pre-flight resolves the area, parses the seam table, reads every
ledger. Prints a state table (one row per seam) with counts, plus a
"Next recommended" line that picks the next seam from the execution
order or current state.

### Auto-discover the area

```
/runbook-orchestrator
```

No arguments. Pre-flight scans `docs/runbooks/*/README.md` from CWD.
One match -> uses it, runs `status`. Multiple matches -> blocker, lists
them, asks the user to pick. Zero matches -> blocker with a tip to pass
an explicit path.

### Launch a specific seam

```
/runbook-orchestrator launch docs/runbooks/data-table-review header-adapter
```

Pre-flight validates `header-adapter` matches a row in the seam table
(case-insensitive against display name and filename). Working-tree
cleanliness check fires. If warnings, accumulates and prompts. On
confirm, extracts the seam's `/goal` block from the README's
`## Invocation` section and prints it ready to paste.

### Propose a new seam from a complexity hotspot

```
/runbook-orchestrator new docs/runbooks/data-table-review
```

Skill prompts the user to describe the hotspot, dispatches
`/ce-brainstorm` with the existing-seam context plus the graduation
test framing, then stubs `<new-seam>.md` + `<new-seam>-ledger.md` plus
a proposed README edit. All three shown as drafts; nothing written
without explicit `y` confirmation.

### Recover a deleted README

```
/runbook-orchestrator new docs/runbooks/data-table-review
```

When the README is missing but seam pairs exist on disk, `new` detects
the recovery scenario and offers to draft a recovered README from the
detected pairs. Marked at the top with a recovery banner so future
readers know it was reconstructed.

### Bootstrap a brand-new runbook area

```
/runbook-orchestrator new docs/runbooks/billing-review
```

When the area-path doesn't exist (or exists empty), `new` routes to
bootstrap. Asks for the codebase area to review and the primary
concern, dispatches `/improve-codebase-architecture` to suggest seam
candidates (with the tightness gate applied), and stubs README + first
seams from the response.

### Audit before launching a new seam

```
/runbook-orchestrator audit docs/runbooks/data-table-review
```

Runs 10 checks. Reports findings grouped by severity (blocker / warn /
info). Doesn't auto-fix anything. Useful after a rebase (catches
rewritten history), after manual ledger edits (catches duplicate
signatures), or on a quarterly hygiene pass.

### Generate a closing report after convergence

```
/runbook-orchestrator report docs/runbooks/data-table-review selection
```

After `/goal` reports `met` and the ledger is fully fixed/closed, this
runs a closing report: ledger summary, files touched, regressions caught
by adversary passes (when the seam ran in implement+adversary mode), and
a tightness assessment via the
`improve-codebase-architecture` skill that names concrete moves for the
next time this seam runs (split, fold, narrow interface, lock a contract
as an ADR). Persisted to `<seam>-report-<YYYY-MM-DD>.md`.

## Why manual-only

This skill is `disable-model-invocation: true` because:

- `launch` produces a prompt that triggers side-effect agents (commits,
  file writes) - Claude should not decide to start a review loop on its
  own
- `new` creates files in a versioned docs folder - the user should be
  the one initiating that
- `audit` is harmless, but pairing it with `launch` and `new` under one
  manual gate is simpler than splitting the skill

If you want auto-triggerable status checks, run `status` manually whenever
you start a session, or pair this skill with a separate auto-triggerable
`runbook-status-suggest` sibling skill in a future iteration.

## What this skill deliberately does not do

- It does not run `/goal` itself. It only assembles the prompt for the
  user to paste. Running `/goal` from inside a skill would nest two loops
  and confuse the evaluator.
- It does not parse ledger findings to decide *what to fix*. The runbook
  and its loop do that.
- It does not author or own the fix protocol. Each area's README owns
  its own fix protocol; the orchestrator reads substitution sites
  (archetype, ADR guardrails, ledger rows) and pastes them into the
  `/goal` invocation, but it does not invent or modify the protocol.
- It does not know about specific codebases. The area's README is the
  source of truth for what's in scope.

## Reference files

- [preflight.md](references/preflight.md) - Shared pre-flight protocol
  (runs at the top of every subcommand)
- [convention.md](references/convention.md) - The runbook folder
  convention this skill expects
- [status.md](references/status.md) - Status subcommand protocol
- [launch.md](references/launch.md) - Launch subcommand protocol
- [new-seam.md](references/new-seam.md) - New subcommand protocol
  (add-seam, recover-README, bootstrap-area flows)
- [readme-template.md](references/readme-template.md) - README template
  used by the bootstrap and recovery flows
- [audit.md](references/audit.md) - Audit subcommand protocol
- [report.md](references/report.md) - Report subcommand protocol
  (closing report with `improve-codebase-architecture` tightness pass)
