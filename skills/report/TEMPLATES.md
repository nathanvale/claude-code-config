# Report Templates

Output format templates for different report modes. Designed for ADHD-friendly reading (wins first) and DM scannability (structured tables).

---

## Deterministic Standup Template

**This is a strict contract. Output EXACTLY this structure every time. No variations, no extra sections, no missing sections. Copy-paste into Teams for Jackie.**

```markdown
## Nathan — DD Mon

**Wins:**
- POS-3044 distributor handling (PR #441 merged)
- POS-3243 Cypress E2E tests ready for review (PR #446)

**Blockers:** None

| Ticket | Stage | PR | Notes |
|--------|-------|-----|-------|
| POS-3243 | PR Review | #446 | Awaiting team review |

**Focus today:** Get reviews, respond to feedback

---
Generated at 06:30 AEDT
```

### Section Rules (MANDATORY)

Every section below MUST appear in every standup, in this exact order:

#### 1. Header
`## Nathan — DD Mon`
- Always `Nathan`, always short date format `DD Mon` (e.g., `04 Feb`)
- Use em dash `—`, not `--`
- No day-of-week name

#### 2. Wins
```
**Wins:**
- <ticket> <summary> (PR #N merged)
- <ticket> <summary> ready for review (PR #N)
```
- Milestones reached: PR merged, PR created, QA verified, plan complete
- If no milestones today: `- (no milestones today)`
- **Always present, never omitted**

#### 3. Blockers
```
**Blockers:** None
```
or
```
**Blockers:**
- <ticket> (<blocker description>) — <context>
```
- From ticket state `blockers[]` and `linked_tickets[].relation === "blocked-by"`
- **Always present, never omitted**

#### 4. Ticket Table
```
| Ticket | Stage | PR | Notes |
|--------|-------|-----|-------|
| POS-3243 | PR Review | #446 | Awaiting team review |
```
- ALL non-merged tickets with recent activity
- **Stage values** (human-readable, NOT raw pipeline names):

| Pipeline Stage | Display As |
|----------------|------------|
| kickoff | Kickoff |
| planned | Planning |
| implementing | Implementing |
| testing | Testing |
| qa_verified | QA Verified |
| pr_created | PR Review |
| in_review | In Review |
| changes_requested | Changes Requested |
| approved | Approved |
| merged | Merged |
- **PR column:** `#N` or `—` if no PR
- If no active tickets: single row `| — | — | — | — |`
- **Always present with header row, never omitted**

#### 5. Focus Today
```
**Focus today:** <one sentence>
```
- Generated from highest-priority active work
- **Always present, never omitted**

#### 6. Footer
```
---
Generated at HH:mm AEDT
```
- Always AEDT timezone
- **Always present, never omitted**

---

## Weekly Template

```markdown
## Nathan — Week of 03-07 Feb

**Shipped:**
- POS-3044: Distributor handling (PR #441 merged)
- POS-3243: Cypress E2E tests (PR #446 merged)

**In Flight:**
- POS-XXXX: Next ticket (implementing)

**Velocity:**
- 2 PRs merged
- Avg time to review: 1.5 days

**Next Week:**
- POS-XXXX continuation
- Sprint planning items

---
Generated at 16:00 AEDT Friday
```

### Field Definitions

**Shipped** — Work that reached `merged` stage this week.

**In Flight** — Work started but not yet merged.

**Velocity** — Quantitative metrics:
- PRs merged count
- Tickets progressed count
- Average time in review (if data available)

**Next Week** — Inferred from:
- In-flight tickets (continuing work)
- Upcoming sprint planning
- Known upcoming tickets

---

## Sprint Template

```markdown
## Sprint: Sprint 23.1

| Ticket | Jira Status | Pipeline Stage | Last Activity |
|--------|-------------|----------------|---------------|
| POS-3044 | In Progress | pr_created | 2h ago |
| POS-3243 | In Progress | implementing | today |
| POS-3036 | To Do | — | no activity |

**Progress:** 2/3 tickets in pipeline (67% with activity)

---
Generated at 10:00 AEDT
```

### Field Definitions

- **Jira Status:** Status from Jira (To Do, In Progress, Done)
- **Pipeline Stage:** Stage from ticket-state, or "—" if not tracked
- **Last Activity:** Relative time since last activity log entry

---

## Velocity Template

```markdown
## Velocity Report

### Stage Transition Counts (Last 30 Days)
| From | To | Count | Avg Time |
|------|-----|-------|----------|
| kickoff | planned | 5 | 0.5 days |
| planned | implementing | 5 | 0.2 days |
| implementing | testing | 4 | 2.1 days |
| testing | qa_verified | 4 | 0.3 days |
| qa_verified | pr_created | 4 | 0.1 days |
| pr_created | in_review | 4 | 0.2 days |
| in_review | approved | 3 | 1.5 days |
| approved | merged | 3 | 0.1 days |

### Bottlenecks
- Longest stage: `implementing` (avg 2.1 days)
- Review wait: `in_review` (avg 1.5 days)

### Trends
- Tickets are moving faster through planning (kickoff → planned < 1 day)
- Implementation takes longest (expected for feature work)

---
Generated at 14:00 AEDT
```

---

## Blockers Template

```markdown
## Current Blockers

| Ticket | Stage | Blocker | Notes |
|--------|-------|---------|-------|
| POS-3044 | implementing | API not ready (POS-3036) | Expected next week |
| POS-XXXX | planned | Waiting on design (Figma) | Follow up with designer |

**Summary:** 2 tickets blocked

### Resolution Paths
- POS-3036 (Sellers API): In progress, ETA next sprint
- Figma design: Ping #design-requests channel

---
Generated at 09:00 AEDT
```

---

## Timeline Template

```markdown
## Timeline: POS-3243

| Time | Skill | Operation | Details |
|------|-------|-----------|---------|
| 03 Feb 09:15 | kickoff | init | Stage: kickoff |
| 03 Feb 09:45 | kickoff | gather_complete | 5 ACs, 8 key files |
| 03 Feb 10:00 | plan | start | — |
| 03 Feb 10:30 | plan | decision | Use MSW for mock data |
| 03 Feb 11:00 | plan | complete | 3 phases, medium |
| 03 Feb 11:05 | ticket-state | advance | kickoff → planned |
| 03 Feb 14:00 | git | commit | feat(msw): add seller mock |
| 03 Feb 14:05 | ticket-state | advance | planned → implementing |
| 04 Feb 09:00 | git | commit | test(cypress): add seller tests |
| 04 Feb 10:00 | qa-test | start | Stage: testing |
| 04 Feb 10:30 | qa-test | complete | 5 pass, 0 fail |
| 04 Feb 10:35 | ticket-state | advance | testing → qa_verified |
| 04 Feb 11:00 | git | pr-create | PR #446 |

**Total Duration:** 1.1 days (first event to latest)
**Current Stage:** pr_created

---
Generated at 11:30 AEDT
```

---

## Day Template

Same format as Standup, but for a specific historical date:

```markdown
## Activity — 03 Feb 2026

**Completed:**
- POS-3044: Moved to pr_created
- POS-3243: Started (kickoff → implementing)

| Ticket | Events | Final Stage |
|--------|--------|-------------|
| POS-3044 | 3 commits, 1 PR | pr_created |
| POS-3243 | kickoff, plan, 2 commits | implementing |

---
Generated at 12:00 AEDT
```

---

## Styling Notes

1. **Wins first** — ADHD brains need dopamine hits. Show accomplishments before problems.

2. **Tables for scanning** — DMs scan, don't read. Keep rows to essential info.

3. **Timestamps in AEDT** — Nathan is in Melbourne. All times should be local.

4. **Markdown compatible** — Output can be pasted directly into Teams, Confluence, or Obsidian.

5. **No emojis** — Per Nathan's preferences, avoid emojis unless explicitly requested.

6. **Generated timestamp** — Always show when the report was generated for context.
