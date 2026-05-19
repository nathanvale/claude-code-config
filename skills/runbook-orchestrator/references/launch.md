# launch subcommand

Assembles the `/goal` invocation for a chosen seam and prints it as a
fenced code block for the user to copy.

## Inputs

- `area-path` (required) - the runbook folder path
- `seam-name` (required) - the seam to launch. Matched case-insensitively
  against the README's seam table column 1 (display name) AND against
  the runbook filename (e.g. both "Column-filter binding" and
  "column-filter-binding" match).

If `seam-name` is missing, run `status` first to show available seams,
then ask the user to pick.

## Pre-flight

Run [shared pre-flight checks](preflight.md) first. Launch is the
strictest subcommand:

- **Missing seam pairs** are a blocker (not just a warn).
- **Working-tree cleanliness** is checked - dirty tree in the seam's
  scope is a warning that prompts before continuing.
- **`seam-name` validation** is launch-specific: if `seam-name` doesn't
  match any row in the seam table (case-insensitive, against both
  display name and filename), abort as a blocker. Print the available
  seam names so the user can correct.

## Protocol

### 1. Use the parsed seam table from pre-flight

Pre-flight has already validated `seam-name` resolves to a row in the
seam table. Use that row's runbook and ledger paths.

### 2. Extract the invocation block

Read the README's `## Invocation` section. Find the sub-heading that
matches the seam display name. Extract the **first fenced code block**
that follows that sub-heading.

If no invocation block is found for the seam:

- Report "no invocation block found under `### <seam name>`"
- Offer to fall back to a default invocation template (see below)
- Ask the user to confirm before printing

### 3. Resolve substitution sites

The README's invocation block may already be fully formed (this is the
common case for data-table-review). If so, skip this step.

If the invocation block references substitution sites like
`<archetype>`, `<ADR-guardrails>`, `<ledger-rows>`, resolve them by:

- **`<archetype>`** -> verbatim copy of the README's
  `### Implementer archetype` block
- **`<ADR-guardrails>`** -> verbatim copy of the seam runbook's
  `## ADR guardrails` section
- **`<ledger-rows>`** -> the ledger's current `open` rows formatted per
  the convention (see [convention.md](convention.md))

The README's fix protocol governs which substitutions are required. The
orchestrator does not invent substitutions; it only resolves ones the
README explicitly references.

### 4. Print the assembled invocation

Use this format:

````
# Launch: <Seam display name>

## Pre-flight check

- Runbook: `<area-path>/<seam>.md`
- Ledger: `<area-path>/<seam>-ledger.md`
- Current state: <state from status>
- Open findings: <count>
- Awaiting decision: <count>

If decisions are pending, address them first (or ask Nathan inline once
the loop resumes).

## /goal invocation

Copy and paste into a fresh session:

```
<assembled /goal invocation>
```

## After it runs

When the loop converges, run:

`/runbook-orchestrator status <area-path>`

to see if the next seam is ready to start.
````

### 4a. Optional: copy the invocation to clipboard

The assembled `/goal` invocation is meant to be pasted into a fresh
session. Offer a one-line clipboard copy when the user is on macOS or
Linux:

| Platform | Command |
| --- | --- |
| macOS | `cat <<'EOF' \| pbcopy` (then the fenced invocation) |
| Linux Wayland | `cat <<'EOF' \| wl-copy` |
| Linux X11 | `cat <<'EOF' \| xclip -selection clipboard` |

The skill itself does not run `pbcopy` automatically - the user may want
to read the invocation first. Mention the option in the launch output
footer:

`Tip: pipe into pbcopy / wl-copy / xclip to copy this directly.`

When the user follows up with "copy that" / "copy to clipboard" /
"clipboard it", run the appropriate command via Bash.

### 5. Default invocation template (fallback only)

If the README has no `## Invocation` section, offer this template:

```
/goal Follow <runbook-path>. Re-read the runbook and <ledger-path> at the
start of every turn. Drive every ledger row to status fixed or closed and
the most recent /ce-code-review pass to zero new findings. Echo the full
ledger status table inline at the end of every turn. Stop after 30 turns.
```

Substitute `<runbook-path>` and `<ledger-path>` from the seam table.

Warn the user this is a fallback and the area's README should be updated
to include a proper invocation block.

## Multi-seam launch (`--all` / `all`)

Surfaced in the SKILL.md `argument-hint` as `[seam-name|--all]`.
Intentionally **does not launch all seams** - the skill refuses and
explains why. Concurrent loops in the same checkout collide on shared
files (`index.ts`, any hook touched by both a contract and a
cross-cutting loop).

On `--all`:

1. Refuse and explain the conflict risk
2. Suggest sequential execution OR `ce-worktree` per seam
3. Print the README's `## Parallel execution` section if present,
   otherwise a default note

The `--all` flag exists so users who naturally try it get a real
explanation, not a silent surprise.

## What to NOT do

- Do not run `/goal` from inside the skill. The skill is `disable-model-
  invocation: true` and prints prompts; it does not execute them.
- Do not modify the runbook or ledger. Read-only.
- Do not assume the README's invocation block is in the same place across
  areas. Look up the sub-heading by seam display name, not by fixed
  ordering.
- Do not validate the invocation's runbook path or ledger path against
  disk - that's `audit`'s job. Launch trusts the README.
