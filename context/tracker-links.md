---
title: "Tracker Links"
type: context
status: active
updated: 2026-08-07
summary: "Render tracker and forge identifiers as clickable links in human-facing surfaces."
---

# Tracker Links

Applies to any tracking or collaboration system, not one vendor: issue trackers (Jira, Linear, Asana, ClickUp, Monday, GitHub Issues), code forges (GitHub, GitLab, Bitbucket), ticketing (ServiceNow, Zendesk), and wiki surfaces (Confluence, Notion) when a specific page is named.

In scope: chat replies, repo markdown (task lists, meeting notes, memory files, research docs, READMEs), any surface a human reads and navigates from.

Out of scope, where bare identifiers are correct: commit messages and branch names (the bare key drives tracker automation), code and code comments, structured or machine-read output (JSON, logs, cursor state, tool arguments), and prose discussing an identifier as a string rather than pointing at it.

## The rule (in-scope only)

- Link the identifier itself; keep the key as the visible text: `[POS-3866](https://<tracker-host>/browse/POS-3866)`, `[gms.app #539](https://github.com/<org>/gms.app/pull/539)`.
- Never replace the key with generic link text. `[the ticket](...)` and `[this PR](...)` destroy scannability.
- Repeated references need linking on first mention per section only; bare keys are fine after that when the link is nearby.
- Derive the base URL from repo config or existing links in the file. Never guess a host.
- If the base URL cannot be determined, write the bare key and say the link was omitted. A fabricated link looks authoritative and leads nowhere.
