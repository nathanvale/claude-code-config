---
name: kickoff
description: Prepare to work on a Jira ticket. Reads ticket, explores affected codebases, and persists gathered context. Run /plan afterwards for interactive planning.
allowed-tools: Bash(git:*), Bash(curl:*), Bash(printenv:*), Bash(python3:*), mcp__plugin_para-obsidian_para-obsidian__*, mcp__plugin_kit_kit__*, mcp__plugin_git_git-intelligence__*, AskUserQuestion, Skill, Task, Read, Glob, Grep
skills: api-discovery, codebase-search, ticket-state, deep-dive
context: fork
argument-hint: POS-XXXX
---

# Kickoff: Gather Context for a Ticket

Automated workflow that takes a JIRA ticket and gathers comprehensive context — reads the ticket, explores affected codebases, identifies gaps, and persists findings. Planning happens interactively via `/plan`.

## CRITICAL: Phase Execution Rules

**This is a 6-phase workflow (Phases 0-5). You MUST execute ALL phases in order.** Do not skip, merge, or infer phases.

Phases: Pre-flight → Read Ticket → Figma → Affected Repos → Explore Codebases (+ Persist) → Handoff

**Mandatory checkpoints — you MUST explicitly execute these or note why they were skipped:**
- **Phase 2 (Figma):** Extract Figma URL from ticket. If no URL found, output "No Figma designs linked to this ticket." Do NOT silently skip.
- **Phase 4f (api-discovery):** Invoke `Skill("api-discovery")` for each dependency entity. Do NOT infer API status from code analysis alone — actually run the skill.

## Workflow

### Phase 0: Pre-flight

1. Run `para_commit` to ensure vault is clean (prevents "uncommitted changes" errors)
2. Search vault for existing project note:
   ```
   para_search({ query: "<TICKET_ID>", dir: "01 Projects", response_format: "json" })
   ```
3. If found, read it with `para_read` and carry forward as context
4. If found, ask user: update existing note or create new?
5. **Initialize pipeline state:**
   ```
   Skill("ticket-state", args: "get <TICKET_ID>")
   ```
   - If success → carry stage forward. Do NOT re-init or regress.
   - If `not_found` → `Skill("ticket-state", args: "init <TICKET_ID>")`
   - If init fails → warn, continue without state.

### Phase 1: Read the Ticket

1. Fetch the full ticket:
   ```
   Skill("jira", args: "view <TICKET_ID>")
   ```
2. Follow linked tickets — parse description for `POS-\d+` references:
   - Read parent epic if exists
   - Read dependency tickets (e.g., API work in progress)
   - Read child tasks
   ```
   Skill("jira", args: "view <LINKED_TICKET>")
   ```
3. Extract key entities from ticket:
   - Ticket type (Story, Bug, Task)
   - Components / domain areas mentioned
   - API endpoints referenced
   - UI elements described (pages, dialogs, filters)
   - Data models / types referenced
   - Figma links
4. **Download Jira attachments** (if any exist):
   Extract attachment metadata from the raw ticket JSON and download to state:
   ```bash
   # Get attachment list
   jira issue view <TICKET_ID> --raw | python3 -c "
   import json, sys
   data = json.load(sys.stdin)
   for a in data.get('fields', {}).get('attachment', []):
       print(f\"{a['id']}:{a['filename']}:{a['size']}:{a['mimeType']}\")
   "
   ```
   If attachments exist:
   ```bash
   mkdir -p ~/.claude/state/tickets/<TICKET_ID>/attachments
   # For each attachment:
   curl -sL -o "$OUTPUT_DIR/$FILENAME" \
     -H "Authorization: Basic $(echo -n 'nathan.vale1@bunnings.com.au:'\"$JIRA_API_TOKEN\" | base64)" \
     "https://bunnings.atlassian.net/rest/api/3/attachment/content/$ID"
   ```
   **Critical:** Use `curl -L` — the endpoint returns a 303 redirect to `api.media.atlassian.com`. Without `-L`, files are 0 bytes.

   After downloading, verify file sizes are non-zero. For image attachments (`.png`, `.jpg`), read them with the `Read` tool to view their contents — these are often QA screenshots showing bugs or design discrepancies that are essential context for understanding the ticket.

   If no attachments → skip, no output needed.

5. **Record linked tickets in state** (if initialized):
   For each linked ticket found:
   ```
   Skill("ticket-state", args: "update <TICKET_ID> --add-linked <KEY> --relation depends-on --link-summary '<summary>'")
   ```
   Use appropriate relation types:
   - `depends-on` — we need this ticket's output
   - `blocked-by` — we can't proceed until this is done
   - `relates-to` — general reference

**DO NOT SKIP Phase 2.** You must now attempt to extract Figma URLs from the ticket. If none found, explicitly note "No Figma designs linked."

### Phase 2: Capture Visual Context (conditional)

Delegates to the **figma** building block skill for all API operations (token validation, seat detection, frame listing, image export).

#### Step 1: Extract Figma URL

From the Phase 1 ticket output (already fetched via `Skill("jira")`), scan the description and comments for Figma URLs matching:
```
https://(www\.)?figma\.com/(design|file|board|proto)/[^?[:space:]]+
```

If no URL → output "No Figma designs linked to this ticket." Skip to Phase 3.

#### Step 2: List Frames

Invoke the figma building block:
```
Skill("figma", args: "frames <FIGMA_URL> --keywords '<ticket keywords>'")
```

If status=failed (rate limited or token issue) → carry error message, skip to Phase 3.

From result, note relevant frame names and IDs.

#### Step 3: Export Design (conditional on seat type)

Check `can_export` from the frames result context.

If `can_export=true`:
```
Skill("figma", args: "export <FIGMA_URL> --node-ids <selected_ids> --output-dir $SCRATCHPAD")
```
View exported PNG with `Read` tool.

If `can_export=false`:
1. Attempt Tier 2 token extraction as fallback:
   ```
   Skill("figma", args: "tokens <FIGMA_URL> --node-id <selected_id>")
   ```
2. If tokens succeed, carry `design_properties` into gathered context (see Step 4).
3. If tokens also fail, note: "View/Collab seat — image export and token extraction failed. Frame names carried as design context."

#### Step 4: Carry Context Forward

From figma skill output, carry forward:
- Frame names and IDs (always available)
- Export paths (if exported)
- Design properties (if token extraction succeeded on a low seat):
  ```json
  {
    "figma": {
      "frames": [...],
      "exported_images": [],
      "design_properties": {
        "text_nodes": [{ "name": "...", "text": "...", "font": "...", "size": 14, "weight": 400 }],
        "colors": ["rgb(0, 102, 204)", ...],
        "dimensions": [{ "name": "...", "type": "...", "width": 320, "height": 240 }]
      },
      "notes": "Image export unavailable (View/Collab seat). Design properties extracted via Tier 2 API."
    }
  }
  ```
- Figma URL for manual reference

When `design_properties` is present, downstream skills (figma-compare, qa-test) can use structured property comparison even without Figma images.

### Phase 3: Determine Affected Repos

Apply detection rules from [REPO_MAP.md](REPO_MAP.md) against the ticket description + ACs.

1. Parse ticket content for keywords matching known repos
2. Check if detected repos exist on disk:
   ```bash
   ls -d /Users/s1010081/code/gms.app 2>/dev/null
   ls -d /Users/s1010081/code/gms.api 2>/dev/null
   ls -d /Users/s1010081/code/voucher 2>/dev/null
   ```
3. Classify each repo as **primary** or **dependency**:
   - **Primary** — repos where we will write code (usually `gms.app`)
   - **Dependency** — repos that provide APIs or services we consume but don't own (usually `gms.api`, `voucher`)
4. **Extract API entities** for dependency repos. Scan the ticket for:
   - Explicit endpoint references (e.g., "GET /sellers", "/api/v1/designs")
   - Entity nouns paired with API verbs (e.g., "fetch sellers", "create order")
   - Linked tickets for backend work (e.g., POS-3036 = "Voucher API /sellers")
   - Type names that imply an API entity (e.g., `ISeller`, `IDesign`)

   Build a list of `{ entity, linkedTicket? }` tuples. Examples:
   - `{ entity: "sellers", linkedTicket: "POS-3036" }`
   - `{ entity: "designs", linkedTicket: null }`

5. Present to user via AskUserQuestion:
   > "Based on the ticket, I believe these repos are affected:
   > - **Primary:** gms.app (frontend implementation)
   > - **Dependency:** gms.api (API proxy), voucher (Voucher API)
   > - **API entities to investigate:** sellers (POS-3036), designs
   > Correct?"
6. User confirms or adjusts

### Phase 4: Explore Codebases

Split exploration by repo category: primary repos get full search + deep dive, dependency repos get API discovery.

#### Primary Repos — Full Exploration

**4a-4b. Search** (uses codebase-search, inline)

Follow the codebase-search workflow (loaded via `skills: codebase-search`). Build the query from: ticket summary + AC key terms + entity names from Phase 3.

For each primary repo, execute:
1. Orient (`kit_file_tree` + `kit_index_prime`)
2. Search (`kit_semantic` + `git_search_commits` — parallel)
3. Refine (`kit_index_overview` on top files)
4. Present (ranked file list)

See [codebase-search/SKILL.md](../codebase-search/SKILL.md) for full workflow and [codebase-search/SEARCH_STRATEGIES.md](../codebase-search/SEARCH_STRATEGIES.md) for tech-stack patterns.

**4c-4e. Deep Dive + Quality** (uses deep-dive, forked)

From the search results, select top 3-5 files. Invoke:

```
Skill({ skill: "deep-dive", args: "<file1> <file2> --focus '<ticket summary>' --include-quality --include-tests" })
```

Map deep-dive output to tech plan:
- File analyses → Current State + Implementation Phases
- Quality findings → Pre-existing Issues table
- Test coverage → Gap Analysis (missing tests)
- Patterns → Implementation Phases (patterns to follow)

#### Dependency Repos — API Discovery

**DO NOT SKIP Phase 4f.** You must now invoke the api-discovery skill for each dependency entity identified in Phase 3 step 4. Do NOT infer API status from code exploration alone — actually run the skill.

For repos that provide APIs we depend on but don't own, use the **api-discovery** skill knowledge (loaded via `skills: api-discovery`).

**4f. Run API Discovery** (via Skill tool)

For each `{ entity, linkedTicket }` extracted in Phase 3 step 4, invoke the api-discovery skill:

```
Skill({ skill: "api-discovery", args: "<entity> --ticket <linkedTicket>" })
```

Examples:
```
Skill({ skill: "api-discovery", args: "sellers --ticket POS-3036" })
Skill({ skill: "api-discovery", args: "designs" })
```

This runs the api-discovery skill in its own forked context with full access to `GMS_API.md` and `VOUCHER_API.md` reference docs. It returns structured JSON matching the api-discovery output schema.

If multiple entities need investigation, invoke them **sequentially** (Skill tool calls are blocking). Collect all results before proceeding to 4g.

**4g. Map Results to Output Template**

Map each api-discovery JSON result to the tech plan sections:

| JSON field | Output template section |
|---|---|
| `repos.*.status` | **API Dependency Status** → Status column |
| `repos.*.route` + `repos.*.httpMethods` | **API Dependency Status** → API column (e.g., `GET /sellers`) |
| `repos.*.responseShape` | **API Dependency Status** → "Response shape for MSW mock" |
| `repos.*.similarEndpoint.pattern` | **API Dependency Status** → "Pattern to follow" |
| `mockStrategy` | **API Dependency Status** → Mock Strategy column |
| `discrepancies[]` | **Pre-existing Issues** table (severity: Medium, timing: Fix during) |
| `confidence` | **Open Questions** — if `"low"`, add question about contract certainty |

Status mapping:
- `"exists"` → populate contract details, no mock needed
- `"in_progress"` → note branch name, populate contract from what exists so far, mock needed temporarily
- `"not_found"` → populate "Pattern to follow" from `similarEndpoint`, mock needed, add linked ticket to Dependencies & Blockers

**4h. Record Key Files in State**

If initialized, record top 5-8 key files discovered during exploration:
```
Skill("ticket-state", args: "update <TICKET_ID> --add-key-file '<path>'")
```

Call once per key file. These provide quick context recovery in future sessions.

**4i. Persist Gathered Context**

Persist ALL exploration findings to the gathered file so they survive across sessions:

```
Skill("ticket-state", args: "set-gathered <TICKET_ID> '<json>'")
```

The JSON must include everything from Phases 1-4:
- `ticket` — summary, description, acceptance_criteria (as `[{ id, text }]`), type, components, figma_url
- `attachments` — `[{ filename, mimeType, size, local_path }]` (downloaded to `~/.claude/state/tickets/<ID>/attachments/`)
- `figma` — frames, exported_images, notes
- `repos.primary[]` — name, path, key_files, patterns, quality_notes
- `repos.dependency[]` — repo, entity, status, route, linked_ticket, contract_summary, mock_needed
- `gaps` — missing_types, missing_tests, quality_issues (`[{ description, file, severity, timing }]`)
- `linked_tickets[]` — key, relation, summary

This makes ALL gathered context recoverable by the `/plan` skill.

### Phase 5: Handoff

Output a summary of gathered findings, suggest a worktree + branch name, and direct to `/plan`. Do NOT generate a technical plan, create an Obsidian note, or advance the pipeline stage.

**Branch name suggestion:** Derive from ticket type and summary:
- Story/Feature → `feat/<TICKET_ID>-short-description`
- Bug → `fix/<TICKET_ID>-short-description`
- Task/Refactor → `chore/<TICKET_ID>-short-description`

Rules: lowercase, kebab-case, max 50 chars, 2-4 words from the ticket summary.

```
## Kickoff Complete: <TICKET_ID>

### What I Found

**Ticket:** <type> — <N> acceptance criteria
**Attachments:** <N> downloaded to `~/.claude/state/tickets/<TICKET_ID>/attachments/` (or "None")
**Figma:** <frame count> frames captured (<seat note if applicable>)
**Repos:** <primary repo> (primary, <N> key files), <dependency repos> (dependency, <status>)
**Gaps:** <N> missing types, <N> untested files, <N> quality issues

### Key Files
| File | Why |
|------|-----|
| `<path>` | <purpose> |
| ... | ... |

### Acceptance Criteria
1. <AC text>
2. ...

### Suggested Branch
`<type>/<TICKET_ID>-short-description`

**All context saved.** Next steps:
1. Create a worktree: `/git:worktree <suggested-branch>`
2. Start planning: `/plan <TICKET_ID>`
```

Log to state:
```
Skill("ticket-state", args: "log <TICKET_ID> 'Kickoff complete: gathered context for <N> ACs, <N> key files, <N> dependencies'")
```

Do NOT:
- Advance stage (stays at `kickoff`)
- Create Obsidian note (the plan skill does this)
- Generate a technical plan (the plan skill does this interactively)
- Ask for user input on the plan (the plan skill handles this in main context)

## Error Handling

| Scenario | Handling |
|---|---|
| Ticket not found | "Could not find JIRA ticket {ID}. Check the ticket key." |
| Repo not cloned | Skip that repo, note: "{repo} not found at expected path. Clone if needed." |
| Kit index fails | Fall back to Grep/Glob for code exploration |
| Semantic search unavailable | Fall back to `Grep` (built-in ripgrep) with keyword patterns |
| No Figma links | Skip Phase 2, note "No Figma designs linked" |
| No Obsidian note found | Proceed to create new one |
| Vault uncommitted changes | Run `para_commit` first (already in pre-flight) |
| Attachment download fails | Warn, continue without attachments. Note "Attachments could not be downloaded" in handoff. |
| JIRA_API_TOKEN not set | Skip attachment download, note "JIRA_API_TOKEN env var not set — cannot download attachments" |
| Empty ticket description | Warn user, ask for context verbally |
| Background agent fails | Continue with available results, note gap in plan |
| ticket-state call fails | Warn and continue — state is additive, not a gate |

### Activity Logging

Log kickoff milestones to the central activity stream:

```bash
~/.claude/bin/activity-log.sh kickoff <op> <TICKET_ID> [extra]
```

**When to log:**

| Phase | Operation | Extra Fields |
|-------|-----------|--------------|
| Phase 0 (state init) | `init` | `,"stage":"kickoff"` |
| Phase 5 (handoff) | `gather_complete` | `,"acs":<count>,"key_files":<count>,"repos":<count>` |

**Example:**
```bash
~/.claude/bin/activity-log.sh kickoff init POS-3243 ',"stage":"kickoff"'
~/.claude/bin/activity-log.sh kickoff gather_complete POS-3243 ',"acs":5,"key_files":8,"repos":2'
```

### Babysitter Inbox Reporting

On transient failures that don't halt the workflow, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):

| Error Point | Code | When |
|-------------|------|------|
| Phase 2 (Figma) | `figma_export_failed` | Figma export fails (rate limit, token issue) — before skipping to Phase 3 |
| Phase 1 (Jira) | `jira_unreachable` | Jira ticket fetch fails — before falling back to manual input |
| Phase 8 (Confluence) | `confluence_creation_failed` | Confluence page creation fails — plan still exists in Obsidian |

## Token Budget

The biggest risk is context window exhaustion. Mitigations:

1. Use `response_format: "json"` on ALL MCP calls
2. Use `kit_index_overview` before `Read` — see symbols before reading source
3. Limit semantic search to `top_k: 5-10` per repo
4. Limit git history to `limit: 10-20` commits
5. Deep-read only 3-5 critical files per repo
6. Skip repos user says aren't relevant (Phase 3)
7. Run deep dives and reviews as background agents — returns summaries, not raw output
8. Dependency repos get lighter treatment — git history + pattern search only
