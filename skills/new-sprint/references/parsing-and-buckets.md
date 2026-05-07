# Parsing & Bucket Details

Detailed parsing recipes, bucket logic, and OS quirks for `/new-sprint`. The main SKILL.md links here for the deep details.

## TASKS.md Done-row parsing

Done rows look like:

```markdown
| May 7 | gms.app #519 | (POS-4038 dep) | Octopus deploy origin field — June |
```

To extract `(repo, pr_number)` pairs scoped to the closing sprint:

```bash
sed -n '/^## ✅ Done.*Sprint <NN>/,/^## /p' TASKS.md \
  | grep -oE '(gms\.app|gms\.api|voucher|<other-spoke>) #[0-9]+'
```

Read spoke-repo names from CLAUDE.md's Hub Architecture table — don't hard-code. The regex alternation must be parameterized at skill-load time.

## Filename-date filter for meetings/logs

Project convention: every `docs/meetings/` and `docs/logs/` file starts with `YYYY-MM-DD-`. Filter on filename date prefix, not mtime:

```bash
THIRTY_AGO=$(date -v -30d +%Y-%m-%d 2>/dev/null || date -d '30 days ago' +%Y-%m-%d)
find docs/meetings docs/logs -maxdepth 1 -type f -name '*.md' \
  | awk -F/ -v cutoff="$THIRTY_AGO" \
    '{ name=$NF; date=substr(name,1,10); if (date >= cutoff) print date "\t" $0 }' \
  | grep -E '(sprint|standup|directives)' \
  | sort -k1,1 -r \
  | cut -f2 \
  | head -10
```

**Why this form:**
- `awk` emits `date<TAB>fullpath` so `sort -k1,1 -r` ranks by date column only — without this, `sort` ranks by full path string and `docs/logs/...` files surface after all `docs/meetings/...` files regardless of date.
- `date -v -30d` is macOS; `date -d '30 days ago'` is Linux — `||` chain handles both.
- `directives` in the grep alternation catches files like `2026-05-07-sprint24-directives-from-sonny.md`.
- mtime is unreliable: git checkouts scramble mtimes, save-on-format bumps mtime without content change. Filename date is authoritative.

## Sprint custom field parsing

`customfield_10004` returns an **array**, not a single value:

```json
{
  "customfield_10004": {
    "value": ["POS Yellow FY2623", "POS Yellow FY2621", "POS Yellow FY2622"]
  }
}
```

**Important:** the array is NOT chronologically sorted. Verified live: POS-3867's array came back as `["FY2623", "FY2621", "FY2622"]` — current sprint first, then arbitrary order. **Do not use array position to infer "current sprint".**

Correct interpretation:
- **Membership** — a ticket is in sprint `X` if `X` appears anywhere in the array. This is the only reliable membership test.
- **Spillover (closing sprint)** = active-sprint name (from Step 2's `state: active` query) appears in the array AND status indicates not-done. Active-sprint name comes from Jira's authoritative source, not the array.
- **In next sprint** = next-sprint name (from Step 2's `state: future` query) appears anywhere in the array.
- **Sprint roll-count** = `len(array)` — order-independent, so still reliable. Tickets with `len ≥ 3` are roll-candidates.

Some tickets have `value: null` (no sprint assigned ever) — treat as general backlog.

## Bucket logic (Step 3)

Mutually exclusive — first match wins:

| Bucket | Condition |
|---|---|
| Spillover (real) | `status IN ("To Do", "In Progress")` AND closing-sprint name in array AND next-sprint name NOT in array |
| Spillover (waiting) | `status IN ("In Test", "In Review", "On Hold")` AND closing-sprint name in array AND next-sprint name NOT in array |
| Already in next sprint | next-sprint name appears anywhere in sprint-array |
| Roll-candidates | `len(sprint_array) >= 3` AND not already in next sprint |
| General backlog | no sprint assigned, OR sprint history doesn't include closing or next sprint |

`In Test` and `On Hold` tickets are **not** developer spillover — those are owned by QA and stakeholder pause respectively. Surface separately.

## Cross-reference Jira against TASKS.md

Detect drift:
- Status mismatches (Jira `In Review`, TASKS.md `Awaiting reviewer`) — surface as warning
- Sprint membership disagreement (Jira has POS-NNNN in active sprint, TASKS.md has it in next-sprint scope) — surface so user confirms whether stakeholder rolled it forward
- Tickets in TASKS.md but not in Jira (closed externally?) — flag for archive
- Completed-in-Jira but still in TASKS.md backlog — flag for cleanup

## Contract date parsing chain (Step 7.5)

Try each in order, stop at first match:

1. **ISO** — `\b(\d{4})-(\d{2})-(\d{2})\b` → parse directly
2. **Long-form** — `(Jan|Feb|...|Dec)(?:uary|...)?\s+(\d{1,2}),?\s+(\d{4})` → parse to ISO
3. **Fuzzy month-only** — `~?\s*(Jan|Feb|...|Dec)(?:uary|...)?\s+(\d{4})` → use last day of month, mark `fuzzy: true`
4. **Quarter** — `Q([1-4])\s+(\d{4})` → use last day of last month in quarter, mark `fuzzy: true`
5. **Relative weeks** — `(\d+)(?:-(\d+))?\s+weeks?\s+from\s+(<date>)` → compute from anchor (use the higher number for conservative estimate)
6. **Unparseable** — surface "couldn't compute runway — date is fuzzy: '<quoted>'"

For fuzzy/unparseable cases, the sprint doc header should still surface what was found:

> "Sprint 24 (FY2624): Wed May 20 → Tue Jun 3. **~6 sprints remaining (contract end fuzzy: 'July 2026' — assumed Jul 31).**"

## Multi-repo PR aggregation (Step 6c)

Read repos from CLAUDE.md Hub Architecture table. Iterate with subshell-cd to avoid leaking cwd:

```bash
for repo in <hub> <spoke-1> <spoke-2> ...; do
  ( cd "$repo" && gh pr list --state merged \
      --search "merged:>=<sprint-start> author:<user>" \
      --json number,title,mergedAt --limit 30 )
done
```

Subshell `( ... )` is required — without it, `cd` would change the calling shell's directory and break subsequent steps.

**Carried-over work:** PRs that shipped early in the closing sprint were often written in the previous sprint. Cross-reference each PR's ticket key against the previous sprint's `In Progress` rows. Label carried-over PRs separately in the report so capacity numbers reflect actual new-sprint throughput.

## Issuelinks filtering (Step 6b)

Real Jira instances have inconsistent link-type names — verified live: a single ticket returned `Parent-Child`, `Relates`, and `Finish-to-Start link (WBSGantt)`, none of which match the spec's earlier `Blocks` / `is blocked by`. Filter by **direction text**, not type name.

**Drop closed links** — only include links where the linked issue's `status.category != "Done"`. A blocker that's already shipped is not a blocker.

**Blocking-semantic detection** — match the inward/outward text:

| Direction | Text contains | Meaning |
|---|---|---|
| `type.inward` | `blocked by` / `cannot start until` / `is blocked` | this ticket is blocked |
| `type.outward` | `blocks` / `linked issue cannot start` | this ticket blocks others |
| `type.outward` | `is parent of` | this ticket is a parent (informational, not blocking) |
| any | `Relates` only | drop unless linked issue is in active scope |

**Comment-mined dependencies** — many "waiting on X" relationships live in comments, not issuelinks. Pull `fields: "comment,description"` and grep the most recent 5 comments + description for these patterns:

- `waiting on <person|team>`
- `blocked by <person|team>`
- `depends on <ticket-or-thing>`
- `needs <person> to <verb>`

Mark comment-derived dependencies in the table as `(from comments, not Jira link)`.

Example: POS-2866 returned 14 issuelinks; after filtering closed + non-blocking, 0 remain. The real "waiting on June for voucher-API filter change" lives in TASKS.md / comments, not issuelinks.

## Section extraction (awk, not sed)

Verified live failure: `sed -n '/^## ✅ Done.*Sprint NN/,/^## /p'` drags in the *next* H2 heading (e.g. `## 🗓️ Reference`) because sed ranges are inclusive on both ends. Use awk with start-flag + exclusion for reliable "extract between H2 N and H2 N+1, exclusive of N+1":

```bash
awk '/^## ✅ Done.*Sprint NN/{flag=1} flag && /^## / && !/Done.*Sprint NN/{flag=0} flag{print}' TASKS.md
```

The pattern is: set flag on the start heading, unset flag when hitting any other H2 heading, print only while flag is set. Works for any "extract section bounded by H2" task — Done tables, Risks, Ask Sonny, etc.

For trailing cleanup: pipe through `sed '/^---$/d'` to drop section separators that often follow the table.

## Done-table verification (Step 0d)

Cap at 10 PRs. **Use per-PR `gh pr view`, not `gh search prs`** — verified live: `gh search prs --owner X --merged "POS-..."` returns empty results, the `--merged` flag isn't valid (the correct form would need `is:merged` in the query string), and ticket-key search hits PR titles inconsistently. Per-PR `gh pr view` with subshell-cd is fast enough for the 10-PR cap and reliably correct:

```bash
( cd "<repo>" && gh pr view <pr-number> --json state --jq .state )
```

Run in parallel via `xargs -P` if latency matters:

```bash
# pairs.txt has lines like: gms.app:519
xargs -P 5 -I{} sh -c '
  pair="{}"; repo="${pair%:*}"; pr="${pair#*:}"
  state=$( ( cd "$REPO_BASE/$repo" && gh pr view "$pr" --json state --jq .state ) )
  echo "$repo #$pr → $state"
' < pairs.txt
```

Surface any non-MERGED claim: "TASKS.md says POS-NNNN done but <repo> #N is <state> — what really happened?"
