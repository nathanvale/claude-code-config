---
name: confluence
description: Create technical plan pages on Confluence and link to JIRA. Use when creating tech plans, documenting implementation approaches, or when user says "create confluence page" or "publish tech plan".
allowed-tools: Bash(curl:*), Bash(jira:*), Bash(git:*), Bash(printenv:*), Bash(python3:*), Read, AskUserQuestion
context: fork
argument-hint: [JIRA-TICKET] [title?]
---

# Confluence Technical Plan Publisher

Creates consistently structured technical plan pages on Confluence and links them to JIRA tickets.

## Prerequisites

Required environment variable: `JIRA_API_TOKEN`

```bash
if [ -z "$(printenv JIRA_API_TOKEN)" ]; then
  echo "ERROR: JIRA_API_TOKEN not set"
  echo "Set it: export JIRA_API_TOKEN='your-token'"
  exit 1
fi
```

**Proxy note:** If curl fails with connection errors mentioning `vzen01.internal.bunnings.com.au`, run `proxy-off` (user is off VPN).

## Workflow

### Step 1: Gather Inputs

Resolve these in order:

1. **JIRA Ticket ID** (required)
   - From `$ARGUMENTS` (first word)
   - Or extract from git branch: `git branch --show-current | grep -oiE 'pos-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'`
   - Or ask user via AskUserQuestion

2. **Title/Summary** (required)
   - From `$ARGUMENTS` (remaining words after ticket ID)
   - Or fetch from JIRA: `jira issue view TICKET --plain 2>/dev/null | head -1`
   - Or ask user

3. **Plan Content** (required)
   - The plan should already exist in the conversation context (user discussed/generated it before invoking this skill)
   - If no plan content is available in context, ask the user to provide it or generate it first

4. **Reviewer** (optional)
   - Ask user via AskUserQuestion with team members as options:
     - Joshua Green (Tech Lead) - default
     - June Xu (Developer)
     - Other (free text)

5. **Parent Page ID** (optional)
   - Default: `15317172325` (Gift Card (GMS) Technical Plans)
   - If user specifies `--parent PAGEID` in arguments, use that instead

### Step 2: Check Prerequisites

```bash
# Verify token exists
printenv JIRA_API_TOKEN | wc -c

# Verify Confluence connectivity
curl -s -o /dev/null -w "%{http_code}" \
  -u "nathan.vale1@bunnings.com.au:$(printenv JIRA_API_TOKEN)" \
  "https://bunnings.atlassian.net/wiki/api/v2/spaces/4686282742"
```

If connectivity fails, suggest `proxy-off` and abort.

### Step 3: Build Page Content

Read the template from [TEMPLATE.md](TEMPLATE.md).

Transform the plan content from conversation context into Confluence storage format HTML. Follow these rules:

**HTML element mapping:**
- Paragraphs: `<p>text</p>`
- Bulleted lists: `<ul><li>item</li></ul>`
- Numbered lists: `<ol><li>item</li></ol>`
- Code references: `<code>symbol</code>`
- Tables: `<table><colgroup><col /><col /></colgroup><tbody><tr><th>Header</th></tr><tr><td>Cell</td></tr></tbody></table>`
- JIRA links: `<a href="https://bunnings.atlassian.net/browse/POS-XXXX">POS-XXXX</a>`
- Phase headings: `<h2>Phase N: Title</h2>`
- Sub-sections: `<h3>Title</h3>`

**Section mapping from plan to template:**

| Plan concept | Template variable | HTML pattern |
|---|---|---|
| What exists today | `{{CURRENT_STATE}}` | `<ul><li>...</li></ul>` or `<p>` |
| High-level summary | `{{APPROACH}}` | `<p>...</p>` |
| Implementation phases | `{{PHASES}}` | Multiple `<h2>Phase N</h2>` blocks |
| Test plan | `{{TESTS}}` | `<h3>Unit Tests</h3>` + `<h3>Component Tests</h3>` |
| Not included | `{{OUT_OF_SCOPE}}` | `<ul><li>...</li></ul>` |
| External dependencies | `{{API_DEPENDENCIES}}` | Table rows with JIRA links |
| Things to clarify | `{{OPEN_QUESTIONS}}` | `<ol><li>...</li></ol>` |
| Files to create/modify | `{{KEY_FILES}}` | Table rows: purpose + `<code>path</code>` |

Substitute all `{{VARIABLE}}` placeholders in the template with the generated HTML.

### Step 4: Create Confluence Page

**Title format:** `{TICKET}: {Summary} — Technical Plan`

```bash
RESPONSE=$(curl -s -X POST \
  -u "nathan.vale1@bunnings.com.au:$(printenv JIRA_API_TOKEN)" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "https://bunnings.atlassian.net/wiki/api/v2/pages" \
  -d '{
    "spaceId": "SPACE_ID",
    "status": "current",
    "title": "PAGE_TITLE",
    "parentId": "PARENT_ID",
    "body": {
      "representation": "storage",
      "value": "ASSEMBLED_HTML"
    }
  }')
```

Parse the response to extract page ID and URL:
```bash
PAGE_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
PAGE_URL="https://bunnings.atlassian.net/wiki/spaces/TDM/pages/$PAGE_ID"
```

**Handle errors:**
- HTTP 400 with "title" in message: duplicate title. Ask user to adjust or append date.
- HTTP 401: token expired or invalid. Suggest regenerating.
- HTTP 404: space or parent not found. Verify IDs.
- Connection refused: suggest `proxy-off`.

### Step 5: Link to JIRA

```bash
jira issue comment add TICKET "Technical plan published: $PAGE_URL"
```

If JIRA comment fails, warn but don't treat as failure -- the page is already created.

### Step 6: Output

Report to user:
1. Confluence page URL (clickable)
2. JIRA comment confirmation
3. One-line summary: "Created tech plan for {TICKET} under Gift Card (GMS) Technical Plans"

## Configuration

See [API.md](API.md) for Confluence API details, defaults, and gotchas.

## Examples

See [EXAMPLES.md](EXAMPLES.md) for usage patterns.
