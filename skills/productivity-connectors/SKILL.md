---
name: productivity-connectors
description: Tool routing reference for external data sources. Lists MCP tools by category (calendar, email, project tracker, knowledge base, chat) with function names and per-project config via .productivity.yml. Do not invoke directly -- this is a reference for other skills.
user-invocable: false
---

# Connectors

Tool routing table for external data sources. Reference this skill when you need to know which MCP tools to call for calendar, email, project tracking, knowledge base, or chat operations.

## Per-Project Config

Each project can declare which connectors are active in `.productivity.yml`:

```yaml
# Productivity connector config for this project
connectors:
  calendar: google-calendar    # google-calendar | microsoft-365 | none
  email: gmail                 # gmail | microsoft-365 | none
  project-tracker: jira        # jira | asana | linear | github-issues | monday | clickup | none
  knowledge-base: confluence   # notion | confluence | none
  chat: none                   # slack | none
```

**How to use this config:**
1. Read `.productivity.yml` to determine which connectors are active
2. Map the connector value to the tool table below
3. If a declared connector's MCP tool isn't available in the session, skip with a note
4. If `.productivity.yml` doesn't exist, tell the user to run `/productivity-setup` first

## Calendar

| Connector | Tools |
|-----------|-------|
| `google-calendar` | `gcal_list_events`, `gcal_get_event`, `gcal_list_calendars`, `gcal_find_my_free_time` |
| `microsoft-365` | Microsoft Graph calendar tools |

**Common patterns:**
- Past 2 days + next 3 days for default sync
- Full week scan for `--deep` mode
- Extract attendees for memory cross-referencing

## Email

| Connector | Tools |
|-----------|-------|
| `gmail` | `gmail_search_messages`, `gmail_read_message`, `gmail_read_thread`, `gmail_list_labels` |
| `microsoft-365` | Microsoft Graph mail tools |

**Common patterns:**
- Unread inbox for default sync
- Sent messages for `--deep` mode (find commitments made)
- Search by sender/recipient for people context

## Project Trackers

| Connector | Tools |
|-----------|-------|
| `jira` | `searchJiraIssuesUsingJql`, `getJiraIssue`, `getVisibleJiraProjects` |
| `asana` | Asana MCP tools |
| `linear` | Linear MCP tools |
| `github-issues` | `gh issue list --assignee=@me` (via Bash) |
| `monday` | Monday.com MCP tools |
| `clickup` | ClickUp MCP tools |

**Common patterns:**
- Open/in-progress issues assigned to user
- Compare against TASKS.md for sync
- Flag items completed externally

## Knowledge Base

| Connector | Tools |
|-----------|-------|
| `notion` | `notion-search`, `notion-fetch`, `notion-query-database-view` |
| `confluence` | `searchConfluenceUsingCql`, `getConfluencePage` |

**Common patterns:**
- Meeting transcription search and retrieval for meeting notes sync
- Recently modified docs for `--deep` mode
- Project documentation lookup

## Chat

| Connector | Tools |
|-----------|-------|
| `slack` | Slack MCP tools |

**Note:** Chat scanning is `--deep` mode only. Not included in default sync due to volume.

## Messages

| Connector | Tools |
|-----------|-------|
| `imessage` | Local CLI: `bun run ~/.claude/skills/imessage-reader/scripts/query-imessage.ts` |

**Common patterns:**
- Default sync: `sync --save-dir ~/code/personal-messages/docs/messages/imessage/`
- Deep sync: `sync --since <7-days-ago> --save-dir ~/code/personal-messages/docs/messages/imessage/`
- Read-through query: `messages --since <date> --search <term>`
- Commitment extraction runs after sync, renders `CommitmentCandidate[]` for triage
- Privacy-sensitive: see `~/code/personal-messages/docs/specs/privacy-and-retention.md`

## Availability Check Pattern

Before calling any tool above, verify it exists:

```
1. Read .productivity.yml for the declared connector
2. Map to the tool name from the table above
3. Attempt the call
4. If tool is unavailable, skip with: "Skipped [source] -- [connector] tools not connected"
5. Continue to next source
```

Never fail the entire sync because one source is unavailable.
