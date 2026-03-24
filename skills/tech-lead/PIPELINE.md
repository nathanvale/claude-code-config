# Pipeline Reference

Compact stage reference distilled from ECOSYSTEM.md.

## Stages

```
kickoff(0) → planned(1) → implementing(2) → testing(3) →
qa_verified(4) → pr_created(5) → in_review(6) →
changes_requested(7) → approved(8) → merged(9)
```

## Auto-Advance Triggers

| From | To | Trigger |
|------|----|---------|
| kickoff | planned | Plan skill completes |
| planned | implementing | First git commit |
| implementing | testing | First qa-test run |
| testing | qa_verified | All ACs + smoke tests pass |
| qa_verified | pr_created | PR created |
| pr_created | in_review | Self-review passes |
| in_review | approved | PR approved on GitHub |
| approved | merged | PR merged |

## Data Flow

```
Jira ticket
  ↓
kickoff → gathered context + ticket state
  ↓
plan → plan file (markdown + Obsidian)
  ↓
implementing → commits on branch
  ↓
qa-test → QA evidence
  ↓
pr-create → GitHub PR
  ↓
review-workflow → reviews + approval
  ↓
merge → done
```

## State Paths

| Path | Owner |
|------|-------|
| `~/.claude/state/tickets/<KEY>.json` | ticket-state |
| `~/.claude/state/tickets/<KEY>-gathered.json` | kickoff via ticket-state |
| `~/.claude/plans/<KEY>-plan.md` | plan |
| `~/.claude/state/qa-test/<KEY>/` | qa-test |
| `~/.claude/state/babysitter/issues/` | babysitter |
| `~/.claude/state/babysitter/inbox.ndjson` | any skill → babysitter |
| `~/.claude/state/tech-lead/last-health.json` | tech-lead |
| `~/.claude/skills/tech-lead/WISDOM.jsonl` | tech-lead |

## Skill Count

19 skill directories. 12 user-invocable, 7 building blocks.
