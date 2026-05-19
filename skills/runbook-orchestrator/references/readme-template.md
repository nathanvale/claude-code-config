# README template

The `new` subcommand's bootstrap and recovery flows draft READMEs from
this template. Substitution sites are marked `{{LIKE_THIS}}`.

The template intentionally matches the data-table-review README's
structure so the orchestrator can parse it without convention-specific
exceptions.

## Template

````markdown
# {{AREA_DISPLAY_NAME}} - Iterative Code Review Runbooks

{{ONE_PARAGRAPH_AREA_DESCRIPTION}}

Each runbook is driven by `/goal` with a short file-pointer condition.
The runbook is the source of truth; the goal just tells the agent to
follow it until the ledger is empty of open rows.

`/goal` requires Claude Code v2.1.139+. Older versions can use `/loop`
as a fallback.

## Why these seams

{{ONE_LINE_RATIONALE_FOR_THE_SEAM_SELECTION}}

**Contract-shaped seams** (state machines, types, documented behaviour):

| Seam | Runbook | Ledger | Files |
| --- | --- | --- | --- |
{{ROWS_FOR_CONTRACT_SEAMS}}

**Cross-cutting seams** (each spans many files):

| Seam | Runbook | Ledger | Files |
| --- | --- | --- | --- |
{{ROWS_FOR_CROSS_CUTTING_SEAMS}}

## Invocation

Pick the seam, then run the file-pointer goal below. The runbook does
the rest.

{{INVOCATION_BLOCKS}}

## Driver: /goal vs /loop

| | `/goal` (preferred) | `/loop` (fallback) |
| --- | --- | --- |
| Re-fire trigger | Previous turn finishes | Time interval elapses |
| Stop condition | Evaluator model confirms condition holds | You stop it, or agent decides |
| Verifies via | Conversation transcript only | Same |
| Min version | Claude Code v2.1.139+ | Any |

`/goal`'s evaluator (a small fast model, Haiku by default) reads only
the **conversation transcript**, not the filesystem. So every runbook
is designed so the agent **echoes the ledger status table inline at
the end of each turn**.

## Turn protocol (shared)

Each seam runbook defines:

1. Files in scope
2. Suggested reviewer personas (passed to `/ce-code-review` to spawn
   in parallel)
3. The scoped audit prompt for `/ce-code-review`
4. Seam-specific ADR guardrails

The shared protocol every runbook follows:

1. Read the runbook and the seam's ledger fresh
2. Run `/ce-code-review` with the scoped audit prompt and suggested
   personas
3. For each finding, compute a stable kebab-case signature
4. Dedupe against the ledger (fixed/closed → drop; open match → leave;
   else insert new open row)
5. Classify each open finding `low` | `high` per the risk policy below
6. For `high`: pause and ask the user
7. Apply the [Fix protocol](#fix-protocol-shared) to the approved queue
8. Re-run `/ce-code-review` and repeat dedupe
9. Echo the full ledger status table inline at the end of every turn

Stop condition: every ledger row is `fixed` or `closed`, and the most
recent `/ce-code-review` pass reports zero new findings.

## Fix protocol (shared)

{{FIX_PROTOCOL_PLACEHOLDER}}

> NOTE: The bootstrap flow leaves this section as a placeholder. Edit
> after creation OR copy the Fix protocol section from another runbook
> area (e.g. `docs/runbooks/data-table-review/README.md`) and adapt.

## Risk classification (auto-fix gate)

**Low risk - auto-fix without asking:**

- Dev-only `console.warn` text fixes, typos, copy edits in JSDoc
- Adding a missing JSDoc block to an exported symbol
- Test coverage gaps where the assertion is obvious from existing tests
- Lint / format / type-narrowing fixes the code already implies

**High risk - pause and ask:**

- Any change to a public type signature in `index.ts`
- Any change to a documented contract
- Any change to a dev-only `console.warn` text, condition, or dedupe
  key
- Anything that contradicts an ADR

## Ledger format

Each seam has its own ledger file. One row per finding. Status moves
`open → fixed | closed`. A finding's `signature` is what dedupe matches
on across passes - keep it stable.

```markdown
| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
```

## Suggested execution order

{{EXECUTION_ORDER}}

## Closing reports

When a seam converges, run:

```
/runbook-orchestrator report {{AREA_PATH}} <seam>
```

This generates `<seam>-report-<YYYY-MM-DD>.md` with a ledger summary, a
files-touched list, and a tightness assessment via the
`improve-codebase-architecture` skill.

## Parallel execution

Do **not** run multiple runbooks concurrently in the same checkout -
the fix steps will collide on shared files. Either:

- Run them sequentially in a single checkout
- Use separate worktrees (`compound-engineering:ce-worktree`)
````

## Substitution site reference

| Site | Filled by | Example |
| --- | --- | --- |
| `{{AREA_DISPLAY_NAME}}` | Last segment of area-path, kebab → Title Case | "Data Table Review" |
| `{{ONE_PARAGRAPH_AREA_DESCRIPTION}}` | Bootstrap: user's answer 1. Recovery: synthesised from detected seams | "Iterative code-review runbooks for the portal-ui DataTable atom kit." |
| `{{AREA_PATH}}` | The area-path verbatim | "docs/runbooks/data-table-review" |
| `{{ONE_LINE_RATIONALE_FOR_THE_SEAM_SELECTION}}` | Bootstrap: ICA's "why these seams" summary. Recovery: "Detected from existing seam pairs on disk." | "The kit is intentionally an atom kit, not a high-level wrapper. The real complexity sits in a handful of narrow seams." |
| `{{ROWS_FOR_CONTRACT_SEAMS}}` | Markdown table rows | `\| Selection contract \| [selection.md](selection.md) \| [selection-ledger.md](selection-ledger.md) \| selection/* \|` |
| `{{ROWS_FOR_CROSS_CUTTING_SEAMS}}` | Markdown table rows; empty if none | (may be empty section) |
| `{{INVOCATION_BLOCKS}}` | One `### Seam name` + fenced `/goal` block per row | (see default invocation template below) |
| `{{EXECUTION_ORDER}}` | Numbered list from ICA's position field, or "No execution order yet - run loops in any order and adjust as you learn." | `1. Selection contract` / `2. Column-filter binding` |
| `{{FIX_PROTOCOL_PLACEHOLDER}}` | Always literal placeholder text on bootstrap/recovery | (see placeholder note in template) |

## Default invocation block (per seam)

```
### {{SEAM_DISPLAY_NAME}}

/goal Follow {{AREA_PATH}}/{{SEAM}}.md. Re-read the runbook and
{{SEAM}}-ledger.md at the start of every turn. Drive every ledger row
to status fixed or closed and the most recent /ce-code-review pass to
zero new findings. Echo the full ledger status table inline at the end
of every turn. Stop after 30 turns.
```

## Bootstrap-vs-recovery difference

| Field | Bootstrap (no prior README) | Recovery (README deleted) |
| --- | --- | --- |
| Area description | From user prompt | "Recovered README; description was lost. Edit this paragraph." |
| Seam table rows | From ICA candidates | From detected seam pairs on disk |
| Invocation blocks | Default template per seam | Default template per detected seam |
| Execution order | From ICA's position field | "Detected from existing seam pairs; original execution order may have differed. Edit if needed." |
| Recovery banner | None | `> **Recovered README** drafted by `/runbook-orchestrator new` on <date>. Review before relying on.` |

## What this template intentionally omits

- **Subcommand-specific content** (selection-specific recipes, area-
  specific conventions) - those go in `<seam>.md`, not the README
- **A full Fix protocol** - left as a placeholder because fix
  protocols are area-specific. The user copies from a sibling area or
  authors one.
- **A specific Implementer archetype** - same reason. The
  data-table-review area has one; future areas may want different
  framings (e.g. a "senior SRE" archetype for infra runbooks).
