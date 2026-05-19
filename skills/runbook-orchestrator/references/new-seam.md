# new subcommand

Three flows, routed by what's present on disk:

1. **Add seam** (default) - existing area with parseable README. Brainstorm
   whether a complexity hotspot deserves its own runbook; stub the runbook
   + ledger files.
2. **Recover README** - area-path exists, seam pairs exist on disk, but
   README is missing. Draft a README from detected seam pairs.
3. **Bootstrap area** - area-path is missing OR exists but has no seam
   files. Create the directory if needed, dispatch
   `improve-codebase-architecture` to suggest seams, draft README +
   first seam stubs.

## Inputs

- `area-path` (required) - the runbook folder path
- `description` (optional, add-seam flow) - the user's description of
  the hotspot. If missing, prompt for it interactively.

## Pre-flight

Run [shared pre-flight checks](preflight.md) first. New-specific notes:

- **Missing area-path** is info, routes to bootstrap flow
- **Missing README** is warn-routes-to-recovery, NOT blocker (unlike
  other subcommands)
- **Empty area** (README exists, no seam pairs) routes to bootstrap
- **Existing area + README + at least one seam pair** routes to default
  add-seam flow

## Flow routing

Decide which flow runs based on disk state:

| Disk state | Flow |
| --- | --- |
| Directory missing | Bootstrap (Section A) |
| Directory exists, README missing, ≥1 seam pair on disk | Recover (Section B) |
| Directory exists, README missing, no seam pairs | Bootstrap (Section A) |
| Directory exists, README missing, seam pairs malformed | Recover (Section B), best-effort |
| Directory exists, README exists, no seam pairs | Bootstrap (Section A) - empty README counts |
| Directory exists, README exists, ≥1 seam pair | Add-seam (Section C) - default flow |

## Section A: Bootstrap area

Used when the area doesn't exist yet OR exists but has no seams.

### A1. Confirm intent

Print:

```
No runbook area found at `<area-path>` (or area exists but has no
seams). The 'new' subcommand can bootstrap a fresh runbook area for
this codebase area.

What this will do:
1. Create `<area-path>/` if missing.
2. Dispatch `/improve-codebase-architecture` against the repo to
   suggest seam candidates.
3. Draft a README plus stubs for the suggested seams.
4. Show drafts; write nothing without your confirmation.

Continue? [y/n]
```

On `n`: stop.

### A2. Gather seed context

Prompt the user for two things:

```
1. What codebase area should this runbook area review?
   (e.g. "packages/portal-ui/src/ui/data-table",
   "src/api/billing", "the SSO sign-in flow")

2. What's the primary concern?
   (e.g. "correctness", "performance", "security", "WCAG AA",
   "data integrity")
```

These become inputs to the `improve-codebase-architecture` dispatch.

### A3. Dispatch improve-codebase-architecture

Construct this prompt for the skill:

````
We are bootstrapping a new runbook area for iterative code review:

- Runbook area path: <area-path>
- Codebase area to review: <user's answer 1>
- Primary concern: <user's answer 2>

Apply your normal protocol (Explore, then present deepening opportunities)
BUT reframe the output as **seam candidates for runbooks**.

For each candidate seam:

- **Display name** (kebab-case slug suitable for a filename)
- **Files in scope** (1-5 source files plus their tests, per the
  tightness gate below)
- **Why it deserves its own runbook** in terms of Module / Interface /
  Implementation / Depth / Seam / Adapter / Locality / Leverage
- **Suggested reviewer personas** (from the conditional ce-* reviewers)
- **ADR guardrails**, if any apply (search for docs/adr/*.md and cite
  the ones that bound this seam)
- **One-line audit prompt summary** (the full prompt comes later when
  the user runs `/runbook-orchestrator new` against the bootstrapped area)
- **Position in execution order** (contract-shaped seams first,
  cross-cutting seams second per the data-table-review precedent)

## Tightness gate (REQUIRED)

Every seam candidate MUST pass:

1. Files in scope list is small (1-5 files typical, 10+ = split)
2. Narrow interface to other seams
3. Audit prompt fits on a screen
4. Findings would stay inside the seam (not require touching files
   outside the Files-in-scope list)
5. No "and also" in the seam name

If a candidate fails any criterion, propose tightening or split into
two candidates.

## Output format

Return 3-7 seam candidates ranked by leverage. Group by
"contract-shaped" vs "cross-cutting". Confidence-gate aggressively - if
the codebase area is small or simple, returning fewer candidates (or
zero) is correct.

## Constraints

- Do NOT propose a high-level wrapper as a seam (anti-pattern).
- Do NOT propose seams that overlap each other - apply the deletion
  test between candidates.
- Prefer seams that pin existing contracts over seams that hunt for
  unknown issues, UNLESS the user's primary concern is hunt-shaped
  (e.g. WCAG AA, security audit).
````

Dispatch via `Agent(subagent_type=general-purpose)` since
`/improve-codebase-architecture` is a skill.

### A4. Draft the bootstrap files

From the ICA output, draft:

**File 1: `<area-path>/README.md`** - use the template in
[readme-template.md](readme-template.md). Fill in:

- Area display name (derive from area-path: last segment, kebab → Title Case)
- Codebase area description (user's answer 1)
- Seam table rows (one per ICA candidate, grouped contract vs cross-cutting)
- Invocation blocks (one per candidate, using the default `/goal`
  template)
- Suggested execution order list (from ICA's position field)

**File 2-N: per-seam stubs** - for each ICA candidate, create
`<area-path>/<seam>.md` and `<area-path>/<seam>-ledger.md` using the
add-seam flow's stubbing templates (see Section C).

### A5. Confirm before writing

Same pattern as add-seam: print all drafts, ask `y/n/show-diff-for-<n>`.
On `y`, write everything. On `n`, discard.

After writing, print:

```
Bootstrapped <area-path> with <N> seam candidates.

Next steps:
1. Edit each <seam>.md to fill in the Scoped audit prompt section
   (the bootstrap left a placeholder).
2. Run `/runbook-orchestrator audit <area-path>` to verify the
   bootstrap landed correctly.
3. Run `/runbook-orchestrator launch <area-path> <seam>` to start
   the first loop.
```

## Section B: Recover README

Used when the area exists with seam pairs on disk but the README is
missing (or so malformed it can't be parsed).

### B1. Confirm intent

```
The README at `<area-path>/README.md` is missing (or unparseable). I
found <N> seam pairs on disk:

  - <seam-1>.md + <seam-1>-ledger.md
  - <seam-2>.md + <seam-2>-ledger.md
  - ...

I can draft a recovered README from these pairs. The drafted README
will have:

- A seam table with one row per detected pair
- A placeholder ## Invocation section (you fill in the /goal blocks)
- A placeholder ## Turn protocol (shared) section pointing at the
  default protocol

Draft a recovery README? [y/n]
```

On `n`: stop.

### B2. Detect seam pairs

Glob `<area-path>/*.md`. For each file:

- If `<name>-ledger.md` exists alongside `<name>.md`, treat as a seam
  pair
- Skip `README.md`, `<seam>-report-*.md`, and any file that doesn't
  pair

For each pair, read the seam runbook and try to extract:

- Display name (from the first H1 heading)
- One-line summary (from the line after the H1, if it follows the
  data-table convention of "**Seam:** ...")
- Ledger path (derived from filename)

If the runbook doesn't follow the convention, fall back to filename →
Title Case for the display name and leave the summary blank.

### B3. Draft the recovered README

Use the template in [readme-template.md](readme-template.md), filling
in:

- Area name (from area-path last segment)
- Seam table rows (one per detected pair)
- Invocation section with one sub-heading per seam, each containing a
  placeholder `/goal` block built from the default template

Mark the recovered file with a note at the top:

```
> **Recovered README** drafted by `/runbook-orchestrator new` on
> <ISO date>. Review the seam table and Invocation section; the
> defaults may not match your prior configuration.
```

### B4. Confirm before writing

Same `y/n/show-diff` pattern.

After writing, recommend the user run:

- `/runbook-orchestrator audit <area-path>` to verify convention
  adherence (the recovery is best-effort and may leave gaps)
- Review the Invocation blocks - the defaults may not match what the
  original README had

## Section C: Add seam (default flow)

(This is the original `new` flow - existing area + README + at least
one seam pair.)

## Protocol

### 1. Gather the hotspot description

If `description` was passed as an argument, use it. Otherwise prompt:

```
Describe the complexity hotspot you want to consider for a new runbook.
What files, what behaviour, why does it feel under-reviewed?
```

The user's answer becomes the seed for `/ce-brainstorm`.

### 2. Gather existing-seam context

Read the README's seam table and the file list from each existing
runbook. Build a one-line summary of what each existing seam already
covers. This becomes "what's already covered" context for the brainstorm.

### 3. Dispatch /ce-brainstorm

Construct a brainstorm prompt that explicitly frames the decision:

````
You are helping decide whether a complexity hotspot in <area-path>
deserves its own runbook in the iterative-review system, or whether it
should fold into an existing seam.

## Hotspot description (from user)

<user's description>

## What's already covered

<one-line summary of each existing seam>

## What I need from you

1. **Decision**: should this be a new seam runbook, or fold into one of
   the existing seams? If fold, name which one and why.
2. **If new**: propose the runbook shell:
   - Display name (kebab-case slug for the filename)
   - Files in scope (paths that the runbook is allowed to touch)
   - Suggested reviewer personas (from the conditional ce-* reviewers)
   - ADR guardrails (which existing ADRs constrain this seam, if any)
   - Scoped audit prompt (the verbatim prompt body for /ce-code-review)
   - Position in the execution order (which existing seams must run
     before this one, which depend on it)
3. **If fold**: identify the specific section of the chosen existing
   runbook where the new audit points belong, and propose the edits.

## Constraints

- The area's existing convention: README.md + <seam>.md + <seam>-ledger.md
- Every seam runbook needs Files in scope, Suggested reviewer personas,
  ADR guardrails, Scoped audit prompt sections (see convention.md)
- The graduation test applies: a new seam justifies its existence only
  if the complexity reappears in multiple files OR documents a contract
  that current runbooks do not exercise. Apply the deletion test - if
  this seam were merged into an existing one, where would complexity
  reappear?

## Tightness gate (REQUIRED)

A new seam must be **tight**. A seam is tight when:

1. **The Files in scope list is small.** Typical: 1-5 source files plus
   their tests. A seam needing >10 files is a sign it's actually two or
   three seams in disguise. If you propose 10+ files, justify each one
   or split the seam.

2. **The interface to the rest of the code is narrow.** The seam should
   export a small, named set of symbols. Other seams should depend on
   that interface, not on internals. If the seam's files are imported
   by 5+ other seams' Files-in-scope lists, the boundary is leaking.

3. **The audit prompt fits on a screen.** If the scoped audit prompt
   has more than ~10 numbered audit items, the seam is doing too many
   contracts. Split it.

4. **Findings stay inside the seam.** Reason about what kinds of
   findings the audit prompt would produce. If most plausible findings
   require touching files outside the Files-in-scope list, the seam
   boundary is wrong. Re-scope before stubbing.

5. **No "and also" in the seam name.** "Selection contract" is tight.
   "Selection contract and dev warnings and snapshot memoisation" is
   three seams. The name reveals the leak.

If any of these fail, recommend a tighter scope OR split into multiple
proposed seams.

Confidence-gate. If you cannot justify a new seam under both the
graduation test AND the tightness gate, recommend fold.
````

Dispatch via `Agent(subagent_type=general-purpose)` since
`/ce-brainstorm` is a skill, not a directly-dispatchable agent. The
general-purpose agent invokes the brainstorm and returns its findings.

Alternative: if the user is in a session where `/ce-brainstorm` can be
invoked directly (interactive mode), the skill can recommend they invoke
it themselves and paste the result back. Choose based on context.

### 4. Handle the brainstorm result

#### If the brainstorm says FOLD

- Print the brainstorm's chosen existing seam and rationale
- Print the proposed edits to that seam's runbook (specific section,
  specific lines)
- Ask the user to confirm before editing
- On confirm: edit the runbook in place

#### If the brainstorm says NEW SEAM

Stub three files (drafts - show to user before writing):

**File 1: `<area-path>/<new-seam>.md`**

Use this skeleton, filling in from the brainstorm output:

````markdown
# Runbook: <Seam display name> review loop

**Seam:** <one-line summary>

**Ledger:** [<new-seam>-ledger.md](<new-seam>-ledger.md)

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Files in scope

<bulleted list from brainstorm>

## Suggested reviewer personas

<bulleted list from brainstorm>

## ADR guardrails

<bulleted list from brainstorm>

## Scoped audit prompt

````
<verbatim prompt body from brainstorm>
````
````

**File 2: `<area-path>/<new-seam>-ledger.md`**

```markdown
# <Seam display name> - findings ledger

Format and protocol: see [README.md](README.md#ledger-format).

| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
```

**File 3: README.md edits** (as a diff for the user to confirm):

- Add a row to the seam table under the appropriate sub-heading
  (contract-shaped vs cross-cutting - the brainstorm should suggest
  which)
- Add a `### <Seam display name>` sub-heading to the `## Invocation`
  section with a `/goal` invocation block
- If the brainstorm proposed a position in the execution order, add
  the seam to the `## Suggested execution order` list

### 5. Confirm before writing

Print the three drafts as a single message. Ask the user:

```
Three files to write / edit:

1. <area-path>/<new-seam>.md (new)
2. <area-path>/<new-seam>-ledger.md (new)
3. <area-path>/README.md (edit - seam table row + invocation block)

Drafts above. Write all three? [y/n/show-diff-for-<n>]
```

On `y`: write the two new files, apply the README edits.
On `n`: discard, nothing written.
On `show-diff-for-3`: print the README diff in full, then re-ask.

## What to NOT do

- Do not dispatch `/ce-brainstorm` without the user's confirmation that
  they want a brainstorm (vs picking an existing seam manually).
- Do not write files without explicit user confirmation. Stub-then-confirm
  is mandatory.
- Do not edit the README's `## Suggested execution order` without the
  brainstorm explicitly proposing a position. If the brainstorm is
  unsure, ask the user to position the new seam manually.
- Do not pick a seam name that collides with an existing seam filename.
  If the brainstorm proposes a colliding name, ask for a different one.
- Do not run `/goal` on the newly stubbed seam from inside the skill -
  the user must launch it via `/runbook-orchestrator launch` after
  the stubs land.

## Example flow

```
$ /runbook-orchestrator new docs/runbooks/data-table-review

Describe the complexity hotspot you want to consider for a new runbook.

> The drag-to-resize column behaviour in HeaderCell — it's not in any
> existing seam and it has subtle keyboard-only support.

[dispatching /ce-brainstorm with context...]

Brainstorm result: NEW SEAM recommended.

  Display name: column-resize
  Files: HeaderCell/HeaderCell.tsx, useColumnResize hook (proposed),
    tests for keyboard resize
  Personas: ce-julik-frontend-races-reviewer (focus during resize),
    ce-correctness-reviewer (clamping), ce-testing-reviewer
  ADR guardrails: ADR-0001 (no high-level wrapper), accessibility runbook
    overlap (focus management may need cross-reference)
  Execution order: after accessibility, before wcag-hunter
  Rationale: keyboard-resize is not exercised by any current seam and
    has its own state machine (drag-start, drag-move, drag-end,
    keyboard-arrow-increment).

Three files to write / edit:

1. docs/runbooks/data-table-review/column-resize.md (new)
2. docs/runbooks/data-table-review/column-resize-ledger.md (new)
3. docs/runbooks/data-table-review/README.md (edit)

Drafts:

[drafts shown]

Write all three? [y/n/show-diff-for-3]
> y

Wrote column-resize.md, column-resize-ledger.md, updated README.md.
Run `/runbook-orchestrator status docs/runbooks/data-table-review` to
confirm the seam table parses correctly, then `launch` when ready.
```
