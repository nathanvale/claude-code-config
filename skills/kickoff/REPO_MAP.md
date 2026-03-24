# Repository Map

Static configuration of known repositories and detection logic for determining which repos are affected by a JIRA ticket.

## Known Repositories

| Repo | Path | Tech | Category |
|------|------|------|----------|
| gms.app | `/Users/s1010081/code/gms.app` | React 19, TypeScript, MUI v6, RTK Query, Redux, MSW v2 | Frontend |
| gms.api | `/Users/s1010081/code/gms.api` | C#, .NET, Azure, MediatR, Entity Framework | Backend API (proxy) |
| voucher | `/Users/s1010081/code/voucher` | C#, .NET, Cosmos DB | Voucher API (source of truth) |

## Worktree Support

`gms.app` may use git worktrees. Check for active worktrees:
```bash
cd /Users/s1010081/code/gms.app && git worktree list 2>/dev/null
```
If a worktree exists for the ticket's branch, use that path instead of the main repo path.

## Detection Rules

Parse the ticket description + acceptance criteria for keywords. Map to repos:

### gms.app (Frontend) — Almost Always Primary
**Keywords:** UI, page, component, filter, dialog, dropdown, button, form, table, grid, column, MSW, mock, Redux, RTK, slice, selector, hook, useState, useEffect, design, hang sell, denomination, barcode, PDF, bulk print, order detail, card search
**Default:** Always include unless ticket is purely backend

### gms.api (Backend API Proxy) — Usually Dependency
**Keywords:** API endpoint, controller, service, GMS API, proxy, MediatR, query handler, command handler, domain model, persistence, authorization, RBAC
**Signals:** Ticket mentions needing a new GMS API endpoint, or has a child task for GMS API work

### voucher (Voucher API) — Usually Dependency
**Keywords:** voucher API, card activation, card creation, denomination, printing, seller, fulfilment state, card status, settlement
**Signals:** Ticket has a linked POS-XXXX for Voucher API work, or mentions GET/POST/PUT to voucher endpoints

## Classification Rules

After detecting repos, classify each as:

### Primary Repo
- We will write code here
- Gets full exploration (orient, semantic search, deep dives, code quality review)
- Usually `gms.app` for frontend stories

### Dependency Repo
- Provides APIs or services we consume but don't own
- Gets API discovery only (check if endpoint exists, extract contract, find patterns)
- Usually `gms.api` and `voucher` for frontend stories

## Decision Heuristic

```
IF ticket is a frontend story (UI, page, component keywords):
  Primary: gms.app
  Dependency: gms.api (if API endpoint mentioned), voucher (if voucher API mentioned)

IF ticket is a backend story (API, controller, service keywords):
  Primary: gms.api
  Dependency: voucher (if voucher API mentioned)

IF ticket is a voucher story (card, activation, denomination keywords):
  Primary: voucher
  Dependency: gms.api (if GMS proxy needed)

DEFAULT: Primary = gms.app
```

Always confirm with user before exploring.
