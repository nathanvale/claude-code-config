---
name: ticket-dive
description: Deep-dive into a Jira ticket. Fetches full ticket, follows linked POS tickets, extracts entities, downloads attachments, and gets Figma design properties. Use when you need complete ticket context without running full kickoff.
allowed-tools: Bash(jira:*), Bash(curl:*), Bash(python3:*), Bash(mkdir:*), Bash(ls:*), Bash(printenv:*), Read, Skill
skills: jira, figma, work-check
context: fork
model: sonnet
argument-hint: POS-XXXX
---

# Ticket Deep-Dive

Lightweight workflow to gather complete ticket context without triggering the full kickoff pipeline. No ticket-state, no code exploration, no persistence - just the ticket and its linked context.

**Ticket ID:** `$ARGUMENTS`

## Step 1: Fetch Ticket

Invoke the jira building block to get the full ticket:

```
Skill("jira", args: "view $ARGUMENTS")
```

From the output, extract and hold:
- **Type** (Story, Bug, Task)
- **Status**
- **Assignee**
- **Priority**
- **Summary**
- **Description** (full text)
- **Acceptance Criteria** (numbered list)
- **Comments** (recent, relevant)

## Step 2: Check for Prior Work

Invoke the work-check building block to scan for existing implementation artifacts:

```
Skill("work-check", args: "$ARGUMENTS")
```

This checks branches, commits, PRs, and worktrees across all local repos. Hold the result for the output summary.

If `work_found: true`, this changes the context of the deep-dive - the ticket has been worked on before (possibly bounced back from QA, reassigned, or partially implemented).

## Step 3: Follow Linked Tickets

Parse the ticket description AND comments for `POS-\d+` references. Deduplicate, then fetch each linked ticket.

**Cap at 5 linked tickets** to prevent token explosion on heavily-linked epics. If more than 5 are found, prioritize:
1. Parent epic
2. Tickets explicitly marked as dependencies/blockers
3. Tickets mentioned in acceptance criteria
4. Other references (skip these if over cap)

For each linked ticket (up to 5):
```
Skill("jira", args: "view <LINKED_KEY>")
```

Record:
- Key
- Relation type (parent, depends-on, relates-to, child)
- Summary
- Status

## Step 4: Download Attachments

Invoke the jira building block to list and download attachments:

```
Skill("jira", args: "attachments $ARGUMENTS")
```

After download completes, read any image attachments (`.png`, `.jpg`, `.jpeg`, `.gif`) with the `Read` tool to view their contents - these are often QA screenshots, mockups, or design references critical for understanding the ticket.

If no attachments exist, note "No attachments" and move on.

## Step 5: Figma Properties (conditional)

Scan the ticket description and comments for Figma URLs matching:
```
https://(www\.)?figma\.com/(design|file|board|proto)/[^?[:space:]]+
```

**If NO Figma URL found:** Output "No Figma designs linked to this ticket." Skip to Step 6.

**If Figma URL found:** Extract design properties using Tier 2 API calls only. See [figma-approach.md](references/figma-approach.md) for rationale.

### 5a. List Frames

Build keywords from the ticket summary (2-4 key terms):

```
Skill("figma", args: "frames <FIGMA_URL> --keywords '<ticket keywords>'")
```

From the result, note relevant frame names and IDs.

If status=failed (rate limited, token issue, no access) - carry error, skip to Step 6.

### 5b. Extract Design Tokens

Pick the most relevant frame ID from the frames result:

```
Skill("figma", args: "tokens <FIGMA_URL> --node-id <frame_id>")
```

From the result, extract:
- **Typography:** font families, sizes, weights
- **Colors:** rgb values
- **Dimensions:** key component sizes

### 5c. DO NOT Export Images

**Never invoke `Skill("figma", args: "export ...")`** from this skill. Export is a Tier 1 operation that burns rate limit budget and is slow. This skill uses Tier 2 only.

Instead, include the direct Figma URL in the output so Nathan can open it in a browser if visual context is needed.

## Step 6: Present Summary

Output a formatted summary using the template from [output-templates.md](references/output-templates.md).

### Entity Extraction

Scan the ticket description, ACs, and comments for:

- **API Endpoints:** URL patterns like `/api/v1/...`, HTTP verbs + resource names
- **UI Elements:** page names, dialog titles, filter labels, button text
- **Data Models:** type/interface names (e.g., `ISeller`, `IDesign`), field references

### Output

Use the exact format from [output-templates.md](references/output-templates.md). Sections:
1. Overview table (type, status, assignee, priority)
2. Prior Work (from work-check - branches, PRs, commits, worktrees)
3. Acceptance Criteria (numbered)
4. Entities Detected (API, UI, Data)
5. Figma (properties table or "No Figma designs linked")
6. Linked Tickets table
7. Attachments count + path

## Error Handling

| Scenario | Handling |
|----------|---------|
| Ticket not found | "Could not find JIRA ticket $ARGUMENTS. Check the ticket key." and stop. |
| Jira CLI fails | Output the error, suggest checking VPN/auth. |
| Linked ticket fetch fails | Skip that ticket, note "(could not fetch)" in linked tickets table. |
| Figma token missing | Note "FIGMA_TOKEN not set" in Figma section, skip properties. |
| Figma rate limited | Note "Rate limited" in Figma section, include URL for manual viewing. |
| Attachment download fails | Note "Download failed" next to affected files, continue. |
| No description | Warn: "Ticket has no description - context may be limited." |
