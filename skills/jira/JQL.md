# JQL Patterns

## Sprint Queries

| Query | JQL |
|-------|-----|
| Current sprint | `sprint in openSprints()` |
| Future sprints | `sprint in futureSprints()` |
| No sprint | `sprint is EMPTY` |

## Status Queries

| Query | JQL |
|-------|-----|
| Open work | `status not in (Done, Cancelled)` |
| Blocked | `status = Blocked` |
| Ready for review | `status = "In Review"` |

## Date Queries

| Query | Flag |
|-------|------|
| Created today | `--created today` |
| Updated this week | `--updated week` |
| Last 10 days | `--updated -10d` |

## Combined Example

```bash
jira issue list -p POS -q "sprint in openSprints() AND status = 'In Progress'" --plain
```
