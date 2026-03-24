# POS Workflow States

## Status Flow

```
To Do → In Progress → In Review → Done
                ↓
            Blocked
                ↓
           Cancelled
```

## Status Descriptions

| Status | Meaning |
|--------|---------|
| To Do | Not started |
| In Progress | Actively working |
| In Review | PR submitted, awaiting review |
| Blocked | Waiting on external dependency |
| Done | Completed |
| Cancelled | Won't fix |

## Moving Issues

```bash
jira issue move POS-2774 "In Progress"
jira issue move POS-2774 "Done"
```
