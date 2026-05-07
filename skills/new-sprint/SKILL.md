---
name: new-sprint
description: Use when the user says "prepare sprint NN", "new sprint", "sprint planning prep", "set up the next sprint", or "clean up TASKS.md for the new sprint". Do not use for mid-sprint task tweaks (route to productivity-tasks) or single-ticket edits. Writes memory/projects/sprint-NN.md and rewrites TASKS.md with carry-over, queue, watch-list, backlog, and done tables. Pulls active + future sprints from Jira to verify naming, reads recent planning notes from Notion.
argument-hint: "[sprint-name | sprint-number] [--bootstrap]"
disable-model-invocation: true
model: sonnet
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - AskUserQuestion
  - mcp__mcp-atlassian__jira_search
  - mcp__mcp-atlassian__jira_get_issue
  - mcp__mcp-atlassian__jira_get_agile_boards
  - mcp__mcp-atlassian__jira_get_sprints_from_board
  - mcp__claude_ai_Notion__notion-search
  - mcp__claude_ai_Notion__notion-fetch
  - mcp__claude_ai_Notion__notion-query-meeting-notes
---

# New Sprint

Prepare a new sprint. Writes a sprint project doc under `memory/projects/sprint-NN.md` and rewrites `TASKS.md` so it leads with current work, not stale history. Verifies sprint naming against the live Jira board, surfaces recent planning and standup signal, and asks for missing context before writing.

## When to use

Trigger on:
- "prepare sprint 24" / "new sprint" / "sprint planning prep" / "set up the next sprint"
- "clean up TASKS.md for the new sprint"
- After a sprint-planning ceremony when the user wants the prep doc rewritten
- When the user has just shipped the last in-flight ticket of the current sprint

Do **not** trigger on:
- Mid-sprint task tweaks → use `productivity-tasks` instead
- General memory updates → use `productivity-sync` or `memory-capture`
- Adding a single ticket → just edit TASKS.md directly

## Prerequisites

- A `.productivity.yml` declaring at minimum `project-tracker: jira` and `knowledge-base: notion` (or the equivalent connectors the project uses)
- An existing `TASKS.md`
- A prior sprint doc at `memory/projects/sprint-*.md` to use as template — OR run with `--bootstrap` to create one from scratch
- Jira MCP + Notion MCP connected in the session (skill verifies in Step 0)
- `gh` CLI installed and authenticated (used for Done-table verification in Step 0d and capacity check in Step 6c)

## Step 0 — Pre-flight checks

Run all of these first. Stop on any hard failure; surface soft failures to the user with a continue/abort prompt.

### 0a — Config file
- `.productivity.yml` exists in repo root → if not, **stop**: "run `/productivity-setup` first"
- `TASKS.md` exists → if not, **stop**: "run `/productivity-setup` first"
- A **template** sprint doc exists at `memory/projects/sprint-*.md` that is **not the target sprint** itself → if not and no `--bootstrap` flag, **stop** and offer: "no prior sprint doc to use as template — re-run with `--bootstrap` to create one from scratch"

> Bug fix: on re-runs, the target sprint's own doc must not be counted as the template, otherwise the skill would only ever check existence after the first prep.

### 0b — Tool availability
- `gh` CLI: probe with `gh auth status`. If it errors, **stop**: "gh not authenticated — run `gh auth login` first"
- Jira: probe with `jira_get_agile_boards(limit: 1)`. If it errors, **stop**: "Jira MCP not connected — sprint metadata will be wrong, abort"
- Notion: probe with `notion-search(query: "sprint", page_size: 1)`. If it errors, **soft fail** and ask: "Notion MCP not connected — meeting prep will be skipped. Continue without meeting context? (Y/N)"

### 0c — Git safety
The skill rewrites TASKS.md in place. Check for uncommitted changes:

```bash
git status --short TASKS.md memory/projects/sprint-*.md
```

If anything is staged or modified:
- Offer: "TASKS.md / sprint docs have uncommitted changes. (1) commit checkpoint first, (2) abort, (3) proceed and clobber"
- Default to (1) — auto-commit `chore(wip): pre-sprint-prep checkpoint` before rewriting

### 0d — Closing sprint Done-table verification

Verify only the **closing sprint's** Done table — not historical / archived ones. Older Done tables get archived in Step 6a, not re-verified here.

Parse `(repo, pr_number)` pairs from the closing-sprint Done table, cap at 10, run per-PR `gh pr view` with subshell-cd in parallel via `xargs -P 5`. Full recipe: [`references/parsing-and-buckets.md`](references/parsing-and-buckets.md) § "Done-table verification" + § "TASKS.md Done-row parsing".

> Note: `gh search prs --merged` doesn't work the way you'd expect — verified live to return empty. Stick with per-PR `gh pr view`.

If any "Done" claim is `OPEN` or `CLOSED` (not `MERGED`), surface: "TASKS.md says POS-NNNN done but <repo> #N is <state> — what really happened?"

> Active-sprint sanity (end_date in the past / too-far-future) is checked inside Step 2, after the Jira board data is available.

## Workflow

### Step 1 — Read the previous sprint as a template

```bash
ls memory/projects/sprint-*.md | grep -v "sprint-<TARGET>.md"
```

**Exclude the target sprint** from the template selection — same rule as Step 0a. The skill must not use its own previous output as the template, otherwise re-runs against an existing sprint-NN.md would inherit from itself and drift. Match by computed target filename (e.g. `sprint-24.md` when targeting FY2624).

Among the remaining files, pick the one with the highest sprint number (e.g. `sprint-23.md`). Note its H2 sections (sprint goals, calendar pressure, scope, decisions, reassignments, risks, showcase plan). The new doc should mirror that structure unless the user says otherwise.

### Step 2 — Verify sprint naming against the live Jira board

This is the load-bearing correctness step. **Do not trust the previous doc's sprint number** — naming drifts (TASKS.md drifted from FY2621 → actual FY2623 in May 2026).

1. Find the board:
   ```
   jira_get_agile_boards(board_name: "<project board name>")
   ```
2. Get active and future sprints:
   ```
   jira_get_sprints_from_board(board_id: "<id>", state: "active")
   jira_get_sprints_from_board(board_id: "<id>", state: "future")
   ```
3. The active sprint is the one closing — capture its real Jira name + numeric `id` and end date.
4. The next future sprint (skip generic ones like "Backlog" / "Planning") is the one we're preparing — capture its name + `id`.

If the user passed an explicit sprint argument, use that as the target instead of the auto-detected next future sprint.

If the previous doc's sprint number disagrees with Jira, **flag it** and correct in the new doc + TASKS.md. Don't silently propagate the old name.

**Active-sprint sanity check (deferred from Step 0):**
- If active sprint `end_date` is **>7 days in the future** AND `start_date` is **>7 days in the past**, ask: "Active sprint doesn't close for >7 days — preparing too early? (continue/abort)". **Skip this prompt** if `start_date` is within the last 7 days — that means planning just happened and the user is deliberately preparing the next sprint while the current one is fresh. Verified live: FY2623 started May 6, user invoked May 8 with Sprint 24 planning already done — the warning was noise.
- If active sprint `end_date` is **in the past**, the active sprint should have closed already — flag loudly to the user; the board is in an unusual state and naming may have drifted further than expected.

### Step 3 — Pull current ticket state from Jira

**Do not include `issuelinks`** in the bulk query — it blows the response past 50KB on a 25-ticket dump. Fetch issuelinks per-ticket in Step 6b only.

```
jira_search(
  jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
  fields: "summary,status,priority,labels,issuetype,customfield_10004",
  limit: 25
)
```

The sprint custom field is an **array** (full sprint history) and is **not chronologically sorted** — verified live: arrays come back in arbitrary order. Use the active-sprint name from Step 2 to determine current-sprint membership, never array position. Membership = name appears anywhere in array. Roll-count = `len(array)` (order-independent).

Buckets: Spillover-real, Spillover-waiting, Already-in-next-sprint, Roll-candidates (`len ≥ 3`), General backlog. Mutually exclusive. Critical: `In Test` / `On Hold` are NOT developer spillover.

Cross-reference Jira vs TASKS.md for status mismatches, sprint-membership disagreements, missing/extra tickets.

**Surface roll-candidates here, not just in Step 6c.** Any ticket with `len(sprint_array) >= 3` gets noted in Step 3's bucket output as a roll-candidate. Step 6c later runs the deeper investigation + user-decision flow, but if 6c is skipped the roll-candidate list still appears in the Step 10 report. This means roll-pattern visibility doesn't depend on capacity-check execution.

Full bucket conditions and array-handling: [`references/parsing-and-buckets.md`](references/parsing-and-buckets.md) § "Sprint custom field parsing" + § "Bucket logic" + § "Cross-reference Jira against TASKS.md".

### Step 4 — Read recent planning and directive signal

Look back ~30 days for planning notes, directive logs, and standups. **Do not use `ls -t` with multiple globs** — it sorts per-glob, surfacing old quarterly planning files. **Do not naïve-sort on full path** — `docs/logs/...` files would lose to `docs/meetings/...` regardless of date.

Use the filename-date filter recipe: [`references/parsing-and-buckets.md`](references/parsing-and-buckets.md) § "Filename-date filter for meetings/logs". One-liner result: returns last 30 days of meeting/log files matching `sprint|standup|directives`, sorted by filename date.

Plus Notion's meeting-notes data source for any sprint-planning meeting in the last 2 weeks the local repo doesn't yet have:

```
notion-query-meeting-notes(filter: { property: "title", filter: { operator: "string_contains", value: { type: "exact", value: "Sprint" } }, ... })
```

For each found item, extract:
- Sprint goals stated by the BA / PM
- Priority directives ("X outranks Y, but pick Z first while I prep")
- Decisions locked (rate-limit vs throttle, modal vs toast, etc.)
- Stakeholder asks ("dedicated Cypress tickets", "loud escalation OK")

### Step 5 — Read relevant feedback memories

Read all `feedback_*.md` under `~/.claude/projects/<project-slug>/memory/` — not just `feedback_sprint*`. Important rules live under names like `feedback_cypress_dedicated_ticket.md`, `feedback_devops_template_escalation.md`, etc.

For each memory, scan for any ticket key matching the new sprint's scope, OR any keyword from the sprint goals (regression, Cypress, deploy, review). Surface relevant ones inline as `**Decisions Locked**` items in the sprint doc, citing the source memory file.

### Step 6 — Five brainstormed prep features

Each substep has an explicit skip condition. Default to running all; skip only when the listed condition holds.

#### 6a — Auto-archive previous sprint's Done section — **skip only if Step 9 hasn't run yet (ordering dependency)**

**Trigger:** any Done table heading containing `archived`, OR older than the last 2 sprints. Keep at most 2 Done tables in TASKS.md.

**Action:** append to `memory/sprint-history.md` (newest-first). Create with frontmatter `title: Sprint History / type: archive / status: rolling / updated: <today>` if missing.

**Sequence (write-before-delete — never reverse):**
1. Extract table from TASKS.md via `awk` — see [`references/parsing-and-buckets.md`](references/parsing-and-buckets.md) § "Section extraction (awk, not sed)". `sed -n '/^## .../,/^## /p'` is fragile; verified live to drag in unrelated H2 headings.
2. Write/append to `memory/sprint-history.md`: insert after `# Sprint History\n` line; create file with frontmatter if missing.
3. **Verify the write succeeded** — file exists, contains the new table heading, frontmatter present.
4. **Only then** delete from TASKS.md.
5. Bump `memory/sprint-history.md` `updated:` frontmatter.

If step 3 fails, abort the whole archive — TASKS.md stays intact, no data loss. Never delete-then-write.

#### 6b — Sprint dependency graph — **skip if no new-sprint tickets found**

For each new-sprint ticket (typically 4-8), pull `issuelinks` + `comment` + `description` per-ticket — **not** in the bulk Step 3 query:

```
jira_get_issue(issue_key: "<ticket>", fields: "issuelinks,comment,description")
```

**Filter aggressively** — verified live: a single ticket can have 14+ links, mostly resolved. Without filtering, the dependency graph becomes a noise table. Drop closed links; match blocking semantics by inward/outward direction text rather than `type.name`; mine comments for "waiting on" patterns. Full filter recipe: [`references/parsing-and-buckets.md`](references/parsing-and-buckets.md) § "Issuelinks filtering".

Surface as a small dependency table at the top of the sprint doc. Catches the "forgot POS-2866 was waiting on June" failure mode without burning context on already-resolved links.

#### 6c — Capacity check vs. last sprint's ship rate (multi-repo) — **skip if `gh` failed in Step 0b**

Discover repos from CLAUDE.md's Hub Architecture table. Iterate via subshell-cd (subshell required — recipe in [`references/parsing-and-buckets.md`](references/parsing-and-buckets.md) § "Multi-repo PR aggregation"). Aggregate PR count across all repos. If new queue is **1.5×** last sprint's aggregate throughput, flag a "Capacity risk" in Risks.

**Capacity comparison window** — use the **last completed sprint's** dates (e.g. FY2622 if the active sprint is FY2623), not the active sprint's in-progress dates. The active sprint hasn't shipped yet — comparing a partial window against the new sprint's queue would understate capacity systematically. Pull the last completed sprint via `jira_get_sprints_from_board(board_id, state: "closed", limit: 1)`.

**Carried-over work** — PRs that shipped early in the closing sprint were often written in the previous sprint. Cross-reference each PR's ticket key against the previous sprint's `In Progress` rows; label carried-over PRs in the report so capacity numbers reflect real new-work throughput.

**Per-repo split** — note "5 PRs in gms.app, 1 in gms.api last sprint" in the sprint doc; useful signal for ramp-up trajectory like onboarding to a new spoke.

**Sprint roll-pattern detection** — using the Step 3 sprint-array length, split into two flavors:

- **Currently rolling** — `len(sprint_array) >= 3` AND in active-or-next sprint (still on the slate, just stale)
- **Abandoned rolls** — `len(sprint_array) >= 3` AND NOT in active-or-next sprint (was queued repeatedly, then dropped)

Stage these as roll-candidate questions for Step 7's batched user-context call — **do not fire `AskUserQuestion` here.** Per-ticket questions inside 6c would blow past the 4-question batch cap and would force user decisions before the full sprint context is available. Surface inline in the report as:

> "⚠️ Currently rolling (queued ≥3 sprints, still in scope):
> - POS-3867 (FY2621 → FY2622 → FY2623) — staged for Step 7 decision
>
> ⚠️ Abandoned rolls (queued ≥3 sprints, now backlog):
> - POS-2866 (FY2615 → FY2616 → FY2617) — staged for Step 7 decision"

If Hub Architecture table is missing, fall back to single-repo count and note the limitation.

#### 6d — Stale ask-X auto-triage — **skip if no `❓ Ask` section in TASKS.md**

For each item in TASKS.md's `## ❓ Ask Sonny / next standup` list, search the last 2 weeks of standup transcripts (Notion + local `docs/meetings/*standup*.md`) for keywords from the question. If a likely answer is found, present it to the user via `AskUserQuestion`:

> "Looks like 'POS-3934 prefix' was answered in the May 7 standup ('parked until SIT unblocked') — close this ask?"

User confirms → remove from list. User denies → keep but annotate with "still open".

#### 6e — Risk roll-forward — **skip silently if no Risks-equivalent section in previous doc** (after exhausting heading-name candidates below)

Section names vary between sprint docs. **Don't grep for `## Risks` only** — verified live: sprint-23.md uses `## Critical Issue (Apr 21)` for its equivalent content. Scan for any of these heading candidates:

- `## Risks`
- `## Risk`
- `## Critical Issue` (with optional date suffix)
- `## Watch` / `## Watchlist`
- `## Blockers`
- `## Concerns`

If multiple match, take all. If none match, surface to user: "Previous sprint had no Risks-equivalent section — none to roll forward. Want to seed a new Risks section?" (don't silently no-op).

For each risk found, present to the user:

> "Last sprint's risk: 'Bulk-print prod May 14 — if regression finds anything, capacity gets eaten.' Still active?"

Three options: still active (carry forward), no longer relevant (drop), evolved (rewrite). Reduces the "re-discover the same risks every planning ceremony" problem.

### Step 7 — Ask the user for additional context

Before writing, present a structured set of questions via `AskUserQuestion`. **All user decisions consolidate here, including roll-candidate decisions staged from Step 6c.** Batch into ≤4 questions per call (the tool's hard cap).

Standard batch (≤4 questions):

- "Confirm sprint dates: <inferred start> → <inferred end> ?"
- "Any tickets you know are coming in that aren't in Jira yet?"
- "I read <list of Step 4 sources>. Any directive from Sonny/BA not covered there that should shape the sprint? (Paste verbatim if helpful — I'll fold into Decisions Locked.)"
- "Any context from the planning ceremony I should fold in that isn't in the meeting notes?"

Roll-candidate batch (one per batch of 4 staged from Step 6c — multiple batches if more candidates):

- "POS-NNNN has rolled <N> sprints — kill / deprioritize / commit for <next-sprint> / unsure?" (per ticket, ≤4 per batch)

Bias toward **few questions, well-targeted**. Don't ask the user to confirm things the Jira board already settled (sprint name, sprint id, end date). Don't ask blank-slate recall prompts — anchor each question to specific docs / tickets the skill already read.

### Step 7.5 — Contract / runway awareness

If `memory/projects/contract-extension.md` (or equivalent) exists, read it for the contract end date. Run the 6-step parse chain (ISO → long-form → fuzzy month-only → quarter → relative weeks → unparseable) — full recipe: [`references/parsing-and-buckets.md`](references/parsing-and-buckets.md) § "Contract date parsing chain".

Compute `Sprints remaining = ceil((parsed_end_date - today) / 14 days)`. **Anchor on today's date**, not `new_sprint_start_date` — the runway clock is ticking now regardless of whether the new sprint has officially kicked off. Anchoring on `new_sprint_start_date` would understate runway during the planning-just-happened window when active+next sprints overlap. Surface in the sprint doc header — example forms:

- Strict: "**6 sprints remaining before contract end (Jul 31, 2026).**"
- Fuzzy: "**~5 sprints remaining (contract end fuzzy: 'July 2026' — assumed Jul 31).**"
- Unparseable: "(Contract runway not computed — date in `contract-extension.md` is unparseable: '<quoted>'.)"

If the contract date is **within 1 sprint** (parsed or fuzzy), escalate to Risks. If unparseable, Risks gets: "Contract runway visibility lost — fix date format in `contract-extension.md`."

### Step 8 — Write the new sprint doc (idempotent)

**Idempotency guard** — if `memory/projects/sprint-NN.md` already exists, diff before overwriting:

1. Read existing file; compute what fresh write would produce
2. Set-diff sections into 4 buckets: **Identical** (write silently), **Changed** (diff summary + ask), **New in fresh** (ask insert/skip), **Removed in fresh** (ask keep/drop)
3. Diff summary format: `N lines added, M removed; first 3 added (80-char truncate)`. Never dump raw section content.
4. Batch AskUserQuestion calls into ≤4 sections each (the tool's hard cap). Group Changed → New → Removed; one batch per group. Header each batch: "Batch X of Y: N changed sections".
5. Frontmatter `updated:` always bumps to today.

Lets the skill run multiple times during planning week without destroying user edits or overflowing the question limit.

**Then write** `memory/projects/sprint-NN.md` — frontmatter + sections matching the previous sprint's template, populated with:

- Sprint goals (from planning meeting + BA directives)
- Calendar pressure (sprint dates from Jira board + known holidays + any release / regression dates from comms)
- **Spillover from previous sprint** (top — must close before new work begins)
- **Ordered queue** (per stakeholder priority directives)
- **Watch-list** (in scope only if pulled in)
- **Backlog** (no action without direction)
- **Decisions locked** (from directives logs + recent feedback memories)
- **Reassignments from previous sprint** (closed PRs + status changes + key bugs)
- **Open questions for planning** (from Step 7 + unresolved drift)
- **Risks** (rolled forward from Step 6e + new ones)
- **Showcase plan** (provisional)

Mirror the previous doc's structure. Use the same heading depth and section ordering — consistency is more valuable than novelty here.

### Step 9 — Rewrite TASKS.md (idempotent)

This is the single biggest sprint-prep payoff. Apply the diff-then-write pattern: detect protected sections in the existing file, compute fresh content, merge or overwrite per-section, then write.

**Protected sections — match by `(emoji, first-content-word)` tuple, NOT full heading text.** Headings drift their suffixes every sprint (`## 🔥 Now — Sprint 23 spillover` vs `## 🔥 Now — Sprint 24 spillover` should both match the same protect rule). Full-text match would lose protection.

Default-merge tuples (preserve user edits, append new content, dedupe):
- `(🔥, Now)` — task list spillover
- `(❓, Ask)` — standup questions
- `(🔗, Dependencies)` — waiting-on entries

Why 2-tuple not just emoji: `🎯` is used for both `## 🎯 Sprint Goal` and `## 🎯 Sprint ordered queue`. Single-emoji match is ambiguous. Use the next word past generic terms like `Sprint`: `(🎯, Goal)` vs `(🎯, ordered)`.

Everything else overwrites. Apply same set-diff + batched-AskUserQuestion handling as Step 8 (≤4 questions per batch).

**In practice — surgical Edit is fine for small changes.** When only 2-3 sections need changes (header, sprint-dates, ❓ Ask, archive-marker), use surgical `Edit` calls instead of the full diff machinery. The set-diff + AskUserQuestion path is for first-write-vs-existing cases where many sections differ. Heuristic: **≤3 changed sections = surgical Edit; ≥4 = full diff with batched questions.** Verified live (May 8, FY2624 prep): user-edited 🔥 Now and 🔗 Dependencies sections were already current; only header/dates/Ask/archive needed updates → 4 Edit calls, no diff infra needed.

**Rewrite top-to-bottom:**

- **Header** — name + role + sprint name (correct from Jira) + dates + 1-line priority steer
- **🎯 Sprint Goal (user's lens)** — 2-3 lines, contract context if relevant
- **Sprint Dates** — real dates from board
- **🔥 Now / spillover** — anything from previous sprint not yet closed; lead with the highest-leverage item. **If empty, render `*No items.*` under the heading** — don't omit the section.
- **🎯 Ordered queue** — Phase A / Phase B style if priorities have a "do these while X grooms Y" structure. Render `*No items.*` if empty.
- **⏸ Watch-list** — pull in only on direction. Render `*No items.*` if empty.
- **📋 Backlog** — no action without ask. Render `*No items.*` if empty.
- **❓ Ask X / next standup** — refreshed (post Step 6d)
- **📋 Operating Manual** — preserve from previous TASKS.md if present
- **🔗 Dependencies** — refreshed
- **🟡 Blocked / Waiting** — refreshed
- **✅ Done (closing sprint)** — keep this sprint's done table; archive older per Step 6a. **Auto-populate the PR column** for each ticket. Search both PR title text and branch name to handle PRs that don't put the ticket key in the title:
  ```bash
  gh pr list --state merged \
    --search "POS-NNNN OR head:POS-NNNN" \
    --json number,mergedAt,author --limit 5
  ```
  Replaces hand-typed PR data with verified board data.
- **🗓️ Reference** — links to memory + meeting notes + logs

### Step 10 — Report

Present a tight summary:

```
Sprint <NN> prep complete:

Project doc: memory/projects/sprint-NN.md (NEW or UPDATED)
TASKS.md: rewritten (sections protected: <list>)

Sprint metadata (verified from Jira):
- Active sprint: <name> (id <id>, ends <date>)
- New sprint: <name> (id <id>, kickoff ~<date>)
- Contract runway: <N> sprints remaining (<end-date>)

Brainstormed prep:
- Archived <N> done tables to <path>
- Surfaced <N> dependencies / blockers
- Capacity: <new-queue-N> tickets vs <last-shipped-N> across <repo-count> repos last sprint (<verdict>)
- Triaged <N> stale ask-X items (<closed>/<kept>)
- Rolled forward <N> risks (<active>/<dropped>)

Open follow-ups for planning:
- <unresolved drift>
- <user-asked questions still pending answer>

⚠️ If you have TASKS.md or sprint-<NN>.md open in an editor, save or close
before re-running this skill — git status can't see editor-resident
unsaved buffers.
```

### Step 11 — Offer Teams / Slack message drafts

After the report, ask the user:

> "Want me to draft Teams/Slack messages? I can prepare:
> 1. **Sprint kickoff post** — a 200-word 'what I'm working on this sprint' digest you can paste into the team channel
> 2. **Per-question DMs** — one-line drafts for each open Ask-X item, addressed to the right person (Sonny, June, Jackie, etc.)
> Both are drafts — you copy and send."

Drafts are written to `~/.claude/cache/new-sprint-drafts-<sprint-name>.md` (creating the cache dir if missing) and shown inline. `~/.claude/cache` survives reboots; `/tmp` doesn't. **Never auto-send.** This is a paste-buffer, not an outbound channel.

#### 11a — Sprint kickoff post format

200 words max, first person, terse. Sections:
- Sprint name + dates + 1-line goal
- Top-1 deliverable Nathan will ship
- Carryover from last sprint (1 line)
- Roll-candidate flags (1 line — only the count, e.g. "2 roll-candidates flagged for review")
- 1-line "detailed asks DM'd separately" reference

**Do NOT restate the asks in the kickoff post** — they go to the per-recipient DMs below. The kickoff post is the *summary*; the DMs are the *asks*. Duplicating across both means recipients see questions twice.

#### 11b — Per-question DM format

For each item in the new sprint's `❓ Ask X / next standup` list:
- Identify the most likely answerer from context (BA → Sonny, FE lead → Josh, voucher API → June, contract → Jackie)
- Draft one line, in the user's voice, with enough context to be answerable
- Group by recipient so the user can paste a multi-question message instead of N separate messages
- Roll-candidate questions go to the BA / PM (typically): "POS-3867 has rolled 3 sprints — kill, deprioritize, or commit for FY2624?"

Example draft:

> **To Sonny:**
> "Hey Sonny — quick sprint-prep ask: are POS-4058/4059 cards groomed yet? Otherwise I'll start with POS-3867 + POS-3795 per your May 7 directive. Also, ready to revisit the 98 Orders prefix on POS-3934 now that SIT is unblocked?"

If the question's answerer is ambiguous, leave it as `**To: ?**` and let the user fill in.

## Notes & gotchas

### Naming drift is the #1 failure mode
Previous sprint docs may use a sprint number that doesn't match Jira (FY2621 in TASKS.md, FY2623 on the board — true case from May 2026). Always trust the board, not the doc, and **announce the correction** so the user can audit.

### Don't auto-create Jira tickets
The skill **never** creates Jira tickets unless the user explicitly says so within the same invocation ("file the cypress ticket too"). Surface "ticket needed for X" as an open follow-up instead. Auto-filing is a side-effect step too risky to bundle into sprint prep.

### Don't auto-transition tickets
Same reasoning. Surface "POS-NNNN looks like it should be In Review" as a question, not as an action.

### Read raw Notion transcripts, not AI summaries
Per `feedback_use_raw_notion_transcripts.md`: Notion AI summaries can invert subject/object. If meeting attribution is load-bearing for a sprint decision, pull the raw transcript via `notion-fetch`.

### Verify quote attribution with the user
Per `feedback_verify_quote_speaker_with_nathan.md`: raw Notion transcripts strip speaker IDs. If a quote drives a sprint decision, surface it back to the user before grounding the sprint doc on it.

### Cypress / tech-debt tickets
Per `feedback_cypress_dedicated_ticket.md`: Cypress backfill always gets its own dedicated ticket. Surface as "ticket needed", don't fold into feature scope.

### Sprint date inference
If the Jira sprint object has `start_date` / `end_date`, use them directly. If not, assume 2-week sprints and roll forward from the active sprint's end date.

## Examples

### Example 1 — User says "prepare sprint 24"

1. Active sprint from Jira → `POS Yellow FY2623` (May 6 → May 20).
2. Next future sprint → `POS Yellow FY2624` (id 25140).
3. Previous doc says "Sprint 23 (FY2621)" — flag the FY2621 → FY2623 drift, correct in new doc.
4. Pull tickets, surface POS-4038 (In Review, residual bug) as spillover.
5. Read May 6 sprint-planning prep + May 7 directives log + May 7 standup.
6. Brainstormed prep:
   - Archive Sprint 22 done table to `memory/sprint-history.md`
   - POS-2866 dep on June's voucher-API change surfaced
   - 4 tickets queued vs 4 PRs shipped last sprint → on capacity
   - Ask-Sonny "PR #517 reviewer" auto-resolves (merged); ask user to confirm closure
   - Risks roll-forward: prod May 14, Voucher 1.5 UAT, Blackhawk barcode confusion (all kept)
7. Ask user: "Sprint 24 dates Wed May 20 → Tue Jun 3 OK? Anything from Sonny in Teams I should fold in?"
8. Write `memory/projects/sprint-24.md` + rewrite TASKS.md.
9. Report.

### Example 2 — User says "new sprint" with no current Sprint 24 doc yet

1. Same as above but no need to verify naming against an existing doc — just pull from Jira and use the previous sprint's structure as template.

### Example 3 — User says "prepare FY2625"

Skips the "next future sprint" auto-detect; targets FY2625 explicitly. If FY2625 isn't on the board yet, stop and ask.

## Anti-patterns

- ❌ Trusting the previous sprint doc's sprint name without checking the board
- ❌ Bundling Jira ticket creation or transitions into sprint prep
- ❌ Asking the user to confirm sprint name / id / dates the board already settled
- ❌ Carrying every old "Done" table forward in TASKS.md indefinitely
- ❌ Re-discovering the same risks at every planning (Step 6e exists to prevent this)
- ❌ Folding Cypress / tech-debt into feature ACs (use a dedicated ticket per `feedback_cypress_dedicated_ticket.md`)
- ❌ Clobbering user's manual TASKS.md / sprint-doc edits on re-run (idempotency at Step 8 and 8.5 prevents this)
- ❌ Auto-sending the Step 11 Teams / Slack drafts — they're a paste buffer, never outbound
- ❌ Treating `In Test` / `On Hold` Jira tickets as developer spillover (those are QA / stakeholder-owned)
- ❌ Hand-typing PR numbers in the Done table — derive from `gh pr list` (Step 9)

## Related skills and memories

- [`productivity-sync`](../productivity-sync/SKILL.md) — runs frequently during a sprint; complements `new-sprint` which runs at the boundary
- [`productivity-tasks`](../productivity-tasks/SKILL.md) — for in-sprint task tweaks
- [`productivity-connectors`](../productivity-connectors/SKILL.md) — connector routing reference
- `memory/feedback_sprint*` — repeat sprint directives the skill reads at Step 5
- `memory/feedback_use_raw_notion_transcripts.md` — Notion AI summary trap
- `memory/feedback_verify_quote_speaker_with_nathan.md` — speaker attribution guard
- `memory/feedback_cypress_dedicated_ticket.md` — don't fold tech-debt into feature scope
