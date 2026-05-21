# Runbook area convention

The `runbook-orchestrator` skill works on any folder that follows this
convention. The data-table-review folder is the reference implementation;
this doc captures the rules that make it work.

## Where an area can live

Two valid locations, same convention:

- **Repo-scope**: `<repo>/docs/runbooks/<name>/` - runbooks tied to a
  specific codebase (e.g. `docs/runbooks/data-table-review/`).
- **User-scope**: `~/.claude/runbooks/<name>/` - host-neutral workflow
  runbooks that operate on a *target* repo passed in at launch
  (e.g. `~/.claude/runbooks/issue-to-pr/`).

Both follow the folder shape and section requirements below. Per-run
ledger state for user-scope runbooks lives in the target repo at
`docs/runbooks/<name>/...`, not in the user-scope area.

## Required folder shape

```
<area-path>/
├── README.md                              # required - index + shared protocol
├── <seam-1>.md                            # required - runbook per seam
├── <seam-1>-ledger.md                     # required - empty ledger or populated
├── <seam-1>-report-YYYY-MM-DD.md          # optional - closing report
├── <seam-2>.md
├── <seam-2>-ledger.md
└── ...                                    # any number of additional seam pairs
```

One README, one runbook per seam, one ledger per seam. Ledgers and
runbooks pair by name: `selection.md` <-> `selection-ledger.md`.

Closing reports are written by the `report` subcommand when a seam
converges. Naming: `<seam>-report-<YYYY-MM-DD>.md`. Multiple reports
per seam are allowed (one per convergence event); same-day collisions
get `-2`, `-3` suffixes. Reports are not required for convergence -
the loop completes without one - but they capture institutional memory
about what the loop touched and where the seam could tighten next time.

## Required sections in README.md

The orchestrator parses these. Section names are conventional - use these
heading texts exactly.

### `## Why these seams` (or any heading containing "seams")

Must contain a markdown table with these columns in order:

```
| Seam | Runbook | Ledger | Files |
| --- | --- | --- | --- |
```

The orchestrator reads:

- **Seam** - display name for the seam (e.g. "Selection contract")
- **Runbook** - markdown link to the seam's `.md` file
- **Ledger** - markdown link to the ledger
- **Files** - one-line summary of files in scope (not used by orchestrator,
  shown to user)

The table can span multiple sub-headings (e.g. "Contract-shaped seams"
plus "Cross-cutting seams"). The orchestrator concatenates all rows from
all tables under the `## Why these seams` section.

### `## Invocation`

One sub-heading per seam, with the heading text matching the seam's
display name. Each sub-heading contains a fenced code block with the
`/goal` invocation.

Example:

````
## Invocation

### Selection

```
/goal Follow docs/runbooks/data-table-review/selection.md. [...]
```

### Column-filter binding

```
/goal Follow docs/runbooks/data-table-review/column-filter-binding.md. [...]
```
````

The orchestrator looks up the seam by display name and copies the
fenced code block verbatim. Substitution sites (if any) are noted in the
README's fix protocol.

### `## Suggested execution order` (optional)

A numbered list of seam display names. The orchestrator uses this to
recommend the next seam after a status check.

## Required sections in each `<seam>.md`

These four sections must exist in every seam runbook. The orchestrator's
audit subcommand checks for them.

| Section | Heading | What it contains |
| --- | --- | --- |
| Files in scope | `## Files in scope` | Bulleted list of file paths the runbook is allowed to touch |
| Suggested reviewer personas | `## Suggested reviewer personas` | Bulleted list of `ce-*-reviewer` agents to dispatch in parallel |
| ADR guardrails | `## ADR guardrails` | Bulleted list of ADR refs and what they forbid |
| Scoped audit prompt | `## Scoped audit prompt` | The verbatim `/ce-code-review` prompt as a fenced code block |

Optional but recommended:

- `## Closing a finding without fixing it` - the runbook's specific
  close reasons (`ADR-contradicts-0001`, `out-of-scope-for-atom-kit`, etc)
- `## /loop fallback` - the equivalent `/loop` invocation

## Required ledger shape

Every `<seam>-ledger.md` follows this format:

```markdown
# <Seam display name> - findings ledger

Format and protocol: see [README.md](README.md#ledger-format).

| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
```

Header rows only when empty. Each finding becomes one data row.

### Ledger row fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer | Sequential, zero-padded to 3 digits (001, 002, ...) |
| `signature` | kebab-case string | Stable across passes - the dedupe key |
| `status` | `open` \| `fixed` \| `closed` | Drives convergence |
| `risk` | `low` \| `high` | Drives the auto-fix gate |
| `summary` | one-line string | Human-readable description |
| `resolution` | string | Commit SHA, close reason, or `pending-nathan` |

### Resolution conventions

| Resolution value | Meaning |
| --- | --- |
| `commit <sha>` | Fix applied in the named commit |
| `pending-nathan` | High-risk; awaiting user decision |
| `pending-fix` | Low-risk; queued for implementer |
| `out-of-scope: <reason>` | Closed; the finding belongs to a different runbook |
| `ADR-contradicts-<adr-id>` | Closed; finding violates a documented ADR |
| `fails-graduation-test` | Closed; finding violates the support-graduation rule |
| `<runbook-specific-reason>` | Closed; see the runbook's "Closing a finding" section |

## What the convention does not require

- **No frontmatter on runbooks.** They are plain markdown.
- **No specific ADR numbering.** The orchestrator reads ADR refs as
  opaque strings; it does not validate them against a global registry.
- **No specific reviewer-persona list.** The orchestrator does not know
  which `ce-*-reviewer` agents exist; it just passes the list through.

## How the orchestrator handles drift

If a README does not match this convention:

- Missing seam table -> `status` returns "cannot parse README"
- Missing `## Invocation` section -> `launch` cannot find the goal block,
  asks user to add one
- Missing `## Suggested execution order` -> `status` skips the "next
  recommended" line, just reports state

The orchestrator never edits the README to fix convention drift. It
reports and asks.
