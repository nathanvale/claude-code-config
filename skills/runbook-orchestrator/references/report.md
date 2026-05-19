# report subcommand

Generates a closing report when a seam converges. Combines a quantitative
summary from the ledger and git log with a qualitative tightness
assessment dispatched through the `improve-codebase-architecture` skill.

## When to run

- **Manual:** `/runbook-orchestrator report <area-path> <seam>` after
  `/goal` reports `met` on the seam
- **Auto-suggested:** the `status` subcommand surfaces a "this seam just
  converged - run `report` next" line when it detects a newly-converged
  seam with no existing report file dated within the last hour
- **Inline:** the area's README can opt the runbook into auto-running
  `report` as the last step of `/goal` convergence (see "Inline mode"
  below)

## Inputs

- `area-path` (required) - the runbook folder path
- `seam` (required) - the seam to report on. Must be `converged` per the
  status classifier; warn-prompt if `awaiting-decision` or `in-progress`

If `seam` is missing, run the eligibility filter (see "Missing seam
argument" below) and ask the user to pick before continuing.

### Missing seam argument

When the user invokes `report` with no `<seam>`, do not abort. Instead:

1. Use the parsed seam table from pre-flight.
2. For each seam, classify it as `converged | in-progress | untouched`
   using the same rules as `status`.
3. For each `converged` seam, check whether
   `<area-path>/<seam>-report-<YYYY-MM-DD>.md` exists (any date).
4. Filter to eligible seams: `converged` AND no existing report file
   from today.
5. If 0 eligible seams: report "No seams are eligible for a closing
   report. Use `/runbook-orchestrator status` to see current state."
6. If 1 eligible seam: confirm "Run report for `<seam>`? [y/n]" and
   proceed on `y`.
7. If 2+ eligible seams: surface them via AskUserQuestion with the
   options as labels. Include a "both - one report each, sequentially"
   option when there are exactly 2 eligible seams.
8. Mid-loop seams (`in-progress`) are excluded from the candidate list
   but mentioned in the status banner so the user knows why they're
   missing.

This mirrors `launch.md`'s missing-seam-name handling but with a tighter
filter (only converged + no-report-today).

## Pre-flight

Run [shared pre-flight checks](preflight.md) first. Report-specific:

- **Seam not converged** is a warn-prompt: "This seam has open findings.
  Reports are usually run after convergence. Continue anyway?"
- **Git unavailable** is a warn: the report will skip the
  commits-touched section but still produce the ledger summary and the
  improve-codebase-architecture dispatch

## Protocol

### 1. Gather the seam summary

Read the seam ledger. Compute:

- Total findings count
- By status: fixed, closed
- By risk: low, high
- Adversary regression catches (signatures with `regression:` prefix) -
  only meaningful when the seam ran in implement+adversary mode (see the
  area README's "Risk-mode matrix"). For implement-only seams (e.g.
  pagination-footer, bundle-externals) this count is always 0 and is not
  the key metric; the iteration count and close-reason distribution are.
  Higher catch counts on adversary-mode seams = the loop caught more
  leaks; the underlying seam may benefit from tightening.
- Close reasons distribution (ADR-contradicts, fails-graduation,
  out-of-scope, etc)
- Iterations to converge (if the runbook has an adversary inner loop,
  count adversary-iteration markers; otherwise use turn count)

### 2. Gather what was touched

If git is available, for every commit referenced by a `resolution:
commit <sha>` row:

- Run `git show --stat <sha>` and collect the file paths
- Deduplicate; this becomes the "files touched" set
- Run `git log --format=%s <sha-list>` to get the commit subject lines

### 3. Dispatch improve-codebase-architecture

Call the `improve-codebase-architecture` skill with this framing:

````
The <seam display name> seam in <area-path> just converged after a
/goal loop. <N> findings landed; <M> were regression catches by the
adversary.

Files touched (from git):
<list>

Files in scope per the runbook (from <seam>.md):
<list from the runbook's ## Files in scope section>

Adversary regression findings this loop:
<list of signatures with `regression:` prefix from the ledger; for
implement-only seams this list is empty by design - state "implement-only
seam, no adversary pass">

Question: walk these files as a seam. Use the language of the
improve-codebase-architecture skill (Module, Interface, Implementation,
Depth, Seam, Adapter, Locality, Leverage). Specifically:

1. Is this seam **tight**? Did the loop have to reach outside the
   "Files in scope" list to fix anything? If yes, name the leak point.
2. Apply the **deletion test** to the seam: would deleting any module
   in it concentrate complexity into one or two callers, or scatter it?
   Modules that fail the test are good candidates for inlining back
   into recipes.
3. Are there findings (adversary catches on adversary-mode seams, or
   late-arriving findings on implement-only seams) that suggest a
   **missing seam boundary** - i.e. complexity that should live in its
   own seam but currently leaks across this one?
4. Suggest concrete tightening moves for the next time this seam runs:
   - File-list adjustments (add files that were touched but not listed;
     remove files that were never touched)
   - Splits (this seam is two seams in disguise)
   - Folds (this seam should merge with another)
   - ADR proposals (a contract kept showing up; lock it down)
   - Interface narrowings (an exported symbol is wider than needed)

Cite specific files and signatures from the data above. Confidence-gate.
No findings is a valid result; do not invent tightening just to fill the
section.
````

The dispatch reads the existing files-in-scope and the adversary
findings so it can reason concretely. It does NOT modify any code or
runbook; suggestions only.

### 4. Compose the report

Write to `<area-path>/<seam>-report-<YYYY-MM-DD>.md`. If a file with the
same date already exists, append `-2`, `-3`, etc.

**Multiple-report rules:**

| Situation | Behaviour |
| --- | --- |
| No report exists for this seam | Write `<seam>-report-<YYYY-MM-DD>.md` |
| Report exists for an earlier date | Write a fresh dated file. The earlier report stays for institutional memory. |
| Report exists for today (same date) | Write `<seam>-report-<YYYY-MM-DD>-2.md` (or `-3` etc.). Warn-prompt the user before doing so: "A report already exists for today. Create a second one anyway? [y/n]" |
| Report exists for today AND ledger has not changed since | Block with a warn-prompt: "Today's report is current. Re-run anyway? [y/n]" - use the latest ledger commit timestamp vs the report file's mtime. |

The eligibility filter in "Missing seam argument" above uses the
"report exists for today" check; same-day collisions are typically
intentional (multiple convergence events) but the warn-prompt makes the
user confirm.

Skeleton:

````markdown
# Convergence report: <Seam display name>

**Area:** <area-path>
**Seam:** <seam>
**Converged at:** <ISO timestamp>
**Loop driver:** /goal (or /loop)

## Summary

- Findings: <total>
- Fixed: <count>
- Closed: <count> (<distribution by close reason>)
- High-risk: <count>
- Adversary regression catches: <count>
- Iterations to converge: <count>

## What was touched

| Commit | Files | Subject |
| --- | --- | --- |
| <sha> | <files> | <subject> |
| ... | ... | ... |

(or "Git unavailable; skipping commit detail." if pre-flight degraded)

## What broke and was caught

For seams that ran in implement+adversary mode, one row per
`regression:`-prefixed adversary finding:

| Signature | What broke | What caught it |
| --- | --- | --- |
| regression:<sig> | <one-line> | adversary pass <N> |

For implement-only seams, replace this section with a single line:
`Implement-only seam (per area README's Risk-mode matrix); no adversary
pass ran. Regressions, if any, would surface in the next launch's
turn-1 review.` Do not render an empty table.

## Tightness assessment

<verbatim output from improve-codebase-architecture dispatch>

## Suggested next-time tightening

<numbered list extracted from the dispatch's "concrete tightening
moves" section>

Each item links to the runbook section (Files in scope, ADR guardrails,
etc.) that would change.

## What this loop established

One paragraph summarising the contracts the loop pinned (new tests,
new JSDoc, new dev-warnings, new ADR refs). This is the
institutional-memory bit a future reviewer reads to understand "what
does this seam guarantee now that it didn't before."
````

### 5. Post-write

After the report file is written:

- Print the report's "Tightness assessment" and "Suggested next-time
  tightening" sections inline so the user sees the key insights
  without opening the file
- Print the path to the saved report
- **Classify each tightening suggestion as one of:**
  - **runbook edit** (file-list adjustments, scoped audit prompt
    corrections, fix-protocol overrides) - candidates for inline
    patching before the next launch
  - **ADR proposal** (a contract worth locking down) - usually a
    separate side-quest, not inline
  - **future ledger row** (a finding shape for the next time this
    seam runs) - park in a "deferred findings" section of the
    ledger or open a follow-up issue
  - **separate runbook** (an entirely new seam) - candidate for
    `/runbook-orchestrator new`
- For runbook-edit suggestions, ask: "Apply these runbook edits before
  the next launch?" before suggesting the next `status` or `launch`
  invocation. Patching the runbook now compounds correctly into the
  next seam's pre-flight; deferring leaves drift.
- **Cross-seam finding extraction.** If the tightness assessment names
  a finding that *also* appears in another seam's report (or another
  seam's ledger), surface it explicitly:

  ```
  Cross-seam finding detected: <signature or short description>
  - This seam: <seam-name>
  - Also in: <other-seam-name> (<reference: report-path or ledger-row>)

  Cross-seam findings are the highest-leverage ADR candidates. Consider:
    [ ] Create cross-seam-findings.md in the area to index these
    [ ] Open an ADR proposal that names both seams as evidence
    [ ] Defer if convergence is in early days (one or two seams done)
  ```

  Detection heuristic: search the tightness-assessment output for
  phrases like "same gap as", "cross-seam", "two independent seams",
  "same class of bug", or any reference by name to another seam in the
  area. If the assessment author explicitly flagged a cross-seam
  coincidence, surface it; do not infer cross-seam findings from
  signature-name overlap alone (false positives are easy).
- Otherwise suggest `/runbook-orchestrator status <area-path>` to see
  what to launch next.

## Inline mode (runbook-driven, not skill-driven)

A runbook's README can opt the loop into auto-running `report` as the
last step of `/goal` convergence. The `/goal` invocation block would
end with:

```
... [normal convergence condition] ... AND once convergence is met,
invoke /runbook-orchestrator report <area-path> <seam> as the final
turn, paste its summary inline, and only then declare the goal met.
```

In this mode the orchestrator is invoked from inside the loop session.
The skill detects this because `seam` is `converged` per the status
check at the time of invocation. Behaviour is identical; only the
trigger differs.

Trade-offs:

- **Pro:** fully hands-off. No "remember to run report" step.
- **Con:** the report runs inside `/goal`'s final turn, eating tokens
  and adding latency. The improve-codebase-architecture dispatch is
  the expensive part.
- **Con:** if the report dispatch fails, `/goal` may not declare
  convergence cleanly.

Default: **manual**. Inline mode is an opt-in per area.

## What to NOT do

- Do not run `report` on a non-converged seam without an explicit
  warn-prompt. Mid-loop reports are misleading.
- Do not modify the seam runbook, the ledger, or any source file. The
  report is a fresh `.md` file; everything else stays put.
- Do not skip the improve-codebase-architecture dispatch silently. If
  the skill is unavailable, write the quantitative sections of the
  report and note "Tightness assessment: skipped (improve-codebase-
  architecture unavailable)" rather than producing a half report.
- Do not auto-suggest report runs from `status` more than once per
  session for the same seam - check whether a report file already
  exists with a timestamp newer than the latest commit.
- Do not infer "no rigour" from a zero adversary-catch count. Check the
  area README's Risk-mode matrix first; implement-only seams (e.g.
  pagination-footer, bundle-externals) converge with zero adversary
  catches by design, not by under-investigation.
