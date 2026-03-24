# Output Template

Use this exact format for the Step 5 summary output.

---

```
## Ticket Deep-Dive: <TICKET_ID>

### Overview

| Field | Value |
|-------|-------|
| Type | <Story/Bug/Task> |
| Status | <status> |
| Assignee | <name> |
| Priority | <priority> |
| Sprint | <sprint name or "Backlog"> |

### Prior Work

| Type | Repo | Details | Age |
|------|------|---------|-----|
| Branch | gms.app | `fix/POS-XXXX-description` (3 commits ahead of master) | 3 days |
| PR | gms.app | #452 - merged | 1 day |
| Worktree | gms.app | `.worktrees/fix-POS-XXXX-description` | - |

**Status:** Active | Stale | No prior work

_If no prior work found:_
No prior implementation work found. Starting fresh.

_If stale work detected, add warnings:_
**Warning:** Branch `fix/POS-XXXX-old` in gms.api has no commits in 45 days (stale).

### Description

<Condensed description - key points, not full text. 2-4 sentences max.>

### Acceptance Criteria

1. <AC text>
2. <AC text>
...

### Entities Detected

- **API Endpoints:** <list or "None referenced">
- **UI Elements:** <pages, dialogs, filters, buttons>
- **Data Models:** <types, interfaces, fields>
- **Business Rules:** <validation, status transitions, calculations>

### Figma

**Link:** <URL> (open in browser for full visual context)

| Property | Details |
|----------|---------|
| Frames | <frame names, comma-separated> |
| Typography | <font families, sizes, weights> |
| Colors | <rgb values> |
| Dimensions | <key component sizes> |

> Paste screenshots below if needed for visual reference.

_If no Figma URL found, replace this section with:_
No Figma designs linked to this ticket.

### Linked Tickets

| Key | Relation | Status | Summary |
|-----|----------|--------|---------|
| POS-XXXX | depends-on | In Progress | <summary> |
| POS-YYYY | parent | Done | <summary> |

_If no linked tickets found:_
No linked POS tickets referenced.

### Attachments

<N> attachment(s) downloaded to `~/.claude/state/tickets/<TICKET_ID>/attachments/`

| File | Type | Size |
|------|------|------|
| <filename> | <mimeType> | <human-readable size> |

_If no attachments:_
No attachments on this ticket.
```
