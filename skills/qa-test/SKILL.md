---
name: qa-test
description: Browser-based QA verification of acceptance criteria using Chrome DevTools MCP. Runs before PR creation.
allowed-tools: Bash, Read, Write, Grep, Glob, Skill, AskUserQuestion, ToolSearch, mcp__chrome-devtools__*
user-invocable: true
argument-hint: <ticket-key> [--retest] [--add-ac "criteria"]
---

# Task

Verify acceptance criteria in a running browser using Chrome DevTools MCP tools.

**Arguments:** `$ARGUMENTS`
- Ticket key: `$0` (e.g., POS-3044)
- Flags: `--retest` (re-run verification), `--add-ac "criteria"` (add extra AC)

**Reference docs:**
- [CHROME_PATTERNS.md](./CHROME_PATTERNS.md) — DevExtreme/React interaction patterns
- [SMOKE_TEST.md](./SMOKE_TEST.md) — Standard smoke test checklist

## Context Strategy

This skill runs **inline** (no `context` field = main conversation) because Phases 0, 2, 3, and 4 require interactive AskUserQuestion calls or MCP tool access. Fork heavy non-interactive bash-only work to Task agents to keep context lean:

| Phase | Context | Why |
|-------|---------|-----|
| 0. Pre-flight | Inline | AskUserQuestion for AC confirmation |
| 1. Setup | **Fork (Task)** | Server startup, port cleanup, polling — bash only, no interaction |
| 2. Verify ACs | Inline (delegates to chrome-verify) | Automated via chrome-verify skill; interactive fallback for failures |
| 3. Smoke tests | Inline | Uses Chrome DevTools MCP tools (MCP unavailable in background subagents) |
| 4. Report | Inline | AskUserQuestion for blocked AC confirmation, display results |
| 5. Cleanup | **Fork (Task)** | Server kill — bash only, no interaction |

When forking, use `Task` tool with `subagent_type: "general-purpose"` and pass all necessary context (KEY, evidence dir). Only fork phases that use **bash commands exclusively** — MCP tools are not available in background subagents per Claude Code docs.

---

## Phase 0: Pre-flight

### 0a. Detect Ticket Key

If `$0` contains `POS-\d+`, use it. Otherwise:
```bash
git branch --show-current | grep -oiE 'pos-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'
```

If no key found:
```
### No Ticket Detected
Run `/qa-test POS-XXXX` with an explicit ticket key.
```
**Stop.**

### 0c. Load Ticket State

```
Skill("ticket-state", args: "get <KEY>")
```

**Gate:** If stage is before `implementing` (index < 2):
```
### Not Ready for QA
<KEY> is at stage `<stage>`. QA verification requires at least `implementing`.
Start coding first, then re-run `/qa-test <KEY>`.
```
Write to babysitter inbox with `qa_run_failed` and message "Stage is <stage>, expected implementing or later." **Stop.**

**Auto-advance to `testing`:** If stage is `implementing` (index 2):
```
Skill("ticket-state", args: "advance <KEY> testing --note 'QA verification started'")
```
**Output immediately after advancing:**
```
Stage advanced: `implementing` → `testing` (QA verification started)
```
This mirrors how `where-am-i` auto-advances `planned` → `implementing` when commits are detected, and how `git pr-create` auto-advances to `pr_created` after PR creation. Always tell the user when a stage transition happens — silent advances are confusing.

If `--retest` flag: skip stage check (allow re-verification at any stage >= implementing).

### 0d. Load Gathered Context (ACs + Attachments)

```
Skill("ticket-state", args: "get-gathered <KEY>")
```

Extract acceptance criteria from the gathered JSON (`ticket.acceptance_criteria` array).

Also extract `attachments[]` from gathered JSON (populated by kickoff Phase 1 step 4). Each attachment has `{ filename, mimeType, size, local_path }`. Files live at `~/.claude/state/tickets/<KEY>/attachments/`.

Also extract `figma.design_properties` from gathered JSON (populated by kickoff Phase 2 when image export was unavailable). This contains structured Figma design data: `text_nodes[]`, `colors[]`, `dimensions[]`. When present, these enable chrome-verify to compare browser computed styles against Figma values without needing screenshots.

**View image attachments:** For each attachment where `mimeType` starts with `image/`, use the `Read` tool to view the file contents. These are often QA screenshots showing bugs or design discrepancies — essential reference material for verifying ACs.

```
Read("~/.claude/state/tickets/<KEY>/attachments/<filename>")
```

If no attachments field or empty array → skip silently (attachments are optional).
If attachment files are missing from disk (path doesn't exist) → warn but continue.

If no gathered context or no ACs found:
```
AskUserQuestion:
  question: "No acceptance criteria found in gathered context. Enter ACs manually?"
  options:
    - "Enter ACs" / "I'll type them in"
    - "Cancel" / "Abort QA verification"
```

If "Cancel": **Stop.**
If "Enter ACs": Use AskUserQuestion to collect each AC one at a time.

### 0e. Confirm ACs

Display all ACs to user, followed by attachments if present:
```
### Acceptance Criteria for <KEY>
1. <AC text>
2. <AC text>
...
```

If attachments were loaded in 0d, display them:
```
### Attachments (from Jira)
- <filename> (<size formatted>, <mimeType>) — [viewed] or [not found]
```
Mark `[viewed]` for image attachments that were successfully read, `[not found]` if the file was missing from disk, or `[skipped]` for non-image types. These serve as reference material during AC verification — especially useful for design comparison bugs.

If `--add-ac` flag present, append the extra AC to the list.

```
AskUserQuestion:
  question: "Proceed with these ACs? You can add extras or modify."
  options:
    - "Proceed" / "Start QA verification with these ACs"
    - "Add AC" / "Add an additional acceptance criterion"
    - "Edit" / "Modify an existing AC"
    - "Cancel" / "Abort QA verification"
```

If "Add AC": collect via AskUserQuestion, loop back to confirm.
If "Edit": collect edits via AskUserQuestion, loop back.
If "Cancel": **Stop.**

### 0f. Chrome DevTools Pre-flight (and Evidence Directory)

```
ToolSearch("select:mcp__chrome-devtools__list_pages")
```

If tool not found:
```
### Chrome DevTools Not Available
The Chrome DevTools MCP server is not connected. Ensure Chrome is running with remote debugging enabled.
```
Write to babysitter inbox: `chrome_devtools_unavailable`. **Stop.**

### 0g. Create Evidence Directory

```bash
mkdir -p ~/.claude/state/qa-test/<KEY>/screenshots
```

---

## Phase 1: Setup — Clean Environment (FORK)

**Fork this entire phase** to a Task agent to keep main context lean. The Task handles server startup, readiness polling, and initial navigation — no user interaction needed.

```
Task(subagent_type: "general-purpose", prompt: "
  Set up dev server for QA testing of <KEY>. Steps:
  1. Kill port 44389: lsof -ti:44389 | xargs kill -9 2>/dev/null
  2. Start server: cd <project_root> && yarn start:mock (background, save PID to ~/.claude/state/qa-test/<KEY>/server.pid)
  3. Poll https://localhost:44389 with curl -k up to 60s
  4. Report: READY or FAILED with error details
  Detect project root from nearest package.json with start:mock script.
")
```

If Task returns FAILED:
```
### Dev Server Failed to Start
`yarn start:mock` did not respond on port 44389 within 60 seconds.
```
Write to babysitter inbox: `dev_server_failed`. Run cleanup. **Stop.**

### 1d. Verify Chrome DevTools Connection (main context)

After Task returns READY, verify Chrome DevTools in main context:

```
mcp__chrome-devtools__list_pages()
```

If fails: write `chrome_devtools_unavailable` to inbox, run cleanup, **stop.**

### 1e. Navigate to Target Page (main context)

Detect route from state's `key_files`:

| key_files pattern | Route |
|-------------------|-------|
| `src/pages/BulkPrintOrders/*` | `/bulkprint/create` |
| `src/pages/Orders/OnlineOrders/*` | `/orders` |
| `src/pages/Orders/OrderDetails/*` | `/orders/1` |
| `src/pages/Cards/*` | `/` |
| `src/pages/BulkActivation/*` | `/bulkactivation` |

If ambiguous or no match:
```
AskUserQuestion:
  question: "Which page should I navigate to for testing?"
  options:
    - "/bulkprint/create" / "Bulk print order creation"
    - "/orders" / "Online orders list"
    - "/" / "Card search (home page)"
    - "/bulkactivation" / "Bulk activation"
```

```
mcp__chrome-devtools__navigate_page(url: "https://localhost:44389<route>")
```

Wait for React hydration:
```
mcp__chrome-devtools__evaluate_script(script: "new Promise(r => setTimeout(r, 3000))")
```

Take initial snapshot:
```
mcp__chrome-devtools__take_snapshot()
```

---

## Phase 2: Verify ACs — Automated via chrome-verify

Primary path is automated browser verification via the `chrome-verify` skill. The interactive per-AC loop is the **fallback**, not the primary path.

### 2a. Build chrome-verify Input

From gathered context (Phase 0d), construct the input:

```json
{
  "key": "<KEY>",
  "route": "<detected route from Phase 1e>",
  "page_url": "https://localhost:44389<route>",
  "evidence_dir": "~/.claude/state/qa-test/<KEY>/screenshots",
  "acceptance_criteria": [
    { "id": "AC1", "text": "<AC text from gathered context>" }
  ],
  "key_files": ["<from gathered context key_files>"],
  "test_files": ["<from gathered context test_files, if any>"],
  "attachments": ["<from gathered context attachments, local_path values>"],
  "design_properties": "<from gathered context figma.design_properties, if present>"
}
```

**Design properties:** When `figma.design_properties` exists in gathered context, include it in the input. Chrome-verify can compare browser computed styles (font-family, font-size, color, dimensions) against the Figma token values to verify design fidelity without requiring screenshots. This is the Tier 2 fallback path — used when Figma image export was unavailable due to View/Collab seat or rate limiting.

Detect `key_files` and `test_files` from gathered context. If gathered context includes a `key_files` array, use it. Otherwise, infer from the route mapping in Phase 1e.

**Attachments:** Include `local_path` values from gathered `attachments[]`. These are Jira attachments downloaded by kickoff (typically QA screenshots of bugs or design discrepancies). Chrome-verify can use them as "expected" reference images when verifying visual ACs.

### 2b. Call chrome-verify

```
Skill("chrome-verify", args: "verify --key <KEY> --route <route> --acs '<ACs JSON>' --key-files '<key_files JSON>' --test-files '<test_files JSON>' --attachments '<attachments JSON>' --design-properties '<design_properties JSON>' --evidence-dir ~/.claude/state/qa-test/<KEY>/screenshots")
```

The `--attachments` argument passes local file paths for Jira attachments (QA screenshots, design references). Chrome-verify uses these as "expected" reference when verifying visual/design ACs — comparing what the browser shows against what QA flagged or what the design specifies.

The `--design-properties` argument passes Figma design tokens extracted via Tier 2 API (when image export was unavailable). Chrome-verify can use `evaluate_script` to read browser computed styles and compare against these Figma values — font-family, font-size, font-weight, color, width, height. Omit this argument if no `design_properties` exist in gathered context.

### 2c. Parse Results

Parse the `### Context for Caller` block from chrome-verify output:
- `status`: pass | partial | fail
- `pass_count`, `fail_count`, `inconclusive_count`
- `results_file`: path to detailed JSON
- `new_gotchas`: count of new patterns learned

### 2d. Handle Results

**Always display per-AC evidence table** after parsing chrome-verify results:

```
### Console & Network Evidence During AC Verification

| AC | Console Errors | Network Errors | Details |
|----|---------------|----------------|---------|
| AC1 | 0 | 0 | Clean |
| AC3 | 2 | 0 | Redux serialization (known) |
| AC9 | 0 | 1 | 404 on /api/v1/foo (NEW) |

Total: 2 console errors (2 known, 0 new), 1 network error (0 known, 1 new)
```

Always show this table — even when all ACs passed and all errors are known patterns.
Read `console_errors` and `network_errors` arrays from each AC result in the chrome-verify JSON.
Classify each error as "known" (matches SMOKE_TEST.md filters) or "NEW".

**If any NEW (non-filtered) errors exist:**
```
AskUserQuestion:
  question: "<N> new errors detected during AC verification. Continue with smoke tests?"
  header: "AC Errors"
  options:
    - "Continue" / "Proceed to smoke tests — errors are informational"
    - "Review details" / "Show full error messages"
    - "Abort" / "Stop QA verification"
```

**If ALL errors are known patterns (or zero errors) AND all ACs pass (confidence >= 0.8):**
```
AskUserQuestion:
  question: "All <pass_count> ACs passed. <N> known console warnings filtered. Continue with smoke tests?"
  header: "Smoke tests"
  options:
    - "Continue" / "Run console errors, network failures, and layout checks"
    - "Skip smoke tests" / "Go straight to the report"
    - "Abort" / "Stop QA verification"
```

- **Continue:** Proceed to Phase 3
- **Skip smoke tests:** Jump to Phase 4 (report) with smoke tests marked as `skipped`
- **Abort:** Run cleanup, stop

**Any fail:**
```
AskUserQuestion:
  question: "<fail_count> ACs failed. Review results?"
  header: "Failures"
  options:
    - "Re-run failed" / "Re-run chrome-verify with only the failed ACs"
    - "Accept results" / "These are genuine failures — proceed with report"
    - "Manual verify" / "Fall back to interactive mode for failed ACs"
    - "Abort" / "Stop QA verification"
```

- **Re-run failed:** Call chrome-verify again with only failed ACs
- **Accept results:** Record as failures, proceed to Phase 3
- **Manual verify:** Fall back to interactive mode (2f) for failed ACs only
- **Abort:** Run cleanup, stop

**Any inconclusive (confidence < 0.5):**
```
AskUserQuestion:
  question: "<inconclusive_count> ACs could not be verified automatically. Confirm?"
  header: "Inconclusive"
  options:
    - "Manual verify" / "Fall back to interactive mode for these ACs"
    - "Accept as pass" / "I've verified these outside the tool"
    - "Accept as blocked" / "Can't test these right now"
```

**chrome-verify returns error:**
- Fall back to interactive mode (2f) for ALL ACs
- Write `chrome_verify_fallback` to babysitter inbox

### 2e. Record Final AC Results

Merge chrome-verify results into the Phase 4 results format:
```json
{
  "ac_id": "AC<i>",
  "ac_text": "<text>",
  "status": "pass|fail|blocked|manually_verified|inconclusive",
  "method": "browser|test_coverage|manual",
  "confidence": 0.85,
  "screenshot": "AC<i>.png",
  "notes": "<details from chrome-verify or user>"
}
```

### 2f. Fallback: Interactive Per-AC Loop

Only used when chrome-verify fails or user requests manual verification for specific ACs.

For each AC that needs interactive verification:

1. If image attachments exist from Phase 0d, re-read them with `Read` tool to have the "expected" visual in context for comparison.
2. Take fresh snapshot: `mcp__chrome-devtools__take_snapshot()`
3. Present snapshot summary to user. If attachments are available, note: "Compare against Jira attachment: `<filename>`"
4. Ask what to do:
   ```
   AskUserQuestion:
     question: "What should I do next for AC<i>?"
     header: "Action"
     options:
       - "Click element" / "Click on a specific element (I'll tell you which)"
       - "Check value" / "Verify a value or state in the page"
       - "Navigate" / "Go to a different page"
       - "Mark result" / "I've seen enough — mark this AC"
   ```

4. Execute the chosen action using Chrome DevTools tools. Refer to [CHROME_PATTERNS.md](./CHROME_PATTERNS.md) for DevExtreme-specific patterns.

5. When "Mark result":
   ```
   AskUserQuestion:
     question: "Result for AC<i>?"
     header: "Result"
     options:
       - "Pass" / "AC is verified — working as expected"
       - "Fail" / "AC is NOT met — describe the issue"
   ```

6. Capture screenshot evidence:
   ```
   mcp__chrome-devtools__take_screenshot()
   ```
   Save to `~/.claude/state/qa-test/<KEY>/screenshots/AC<i>.png`

7. If fail, ask for notes via AskUserQuestion.

---

## Phase 3: Smoke Tests — Route Sweep (inline — MCP tools required)

This phase runs inline because Chrome DevTools MCP tools are not available in background subagents.

### 3.0 Read SMOKE_TEST.md

```
Read("~/.claude/skills/qa-test/SMOKE_TEST.md")
```

Load known filter patterns. This is mandatory — do not rely on memory for known patterns.

### 3.1 Determine Story Routes

From `key_files`, detect ALL routes the story touches (not just the primary route used for AC verification):

| key_files pattern | Route |
|-------------------|-------|
| `src/pages/BulkPrintOrders/CreateBulkPrintOrder*` | `/bulkprint/create` |
| `src/pages/BulkPrintOrders/PrintOrderList*` | `/printOrderHistory` |
| `src/pages/Orders/OnlineOrders/*` | `/orders` |
| `src/pages/Orders/OrderDetails/*` | `/orders/1` |
| `src/pages/Cards/*` | `/` |
| `src/pages/BulkActivation/*` | `/bulkactivation` |

If the story touches shared components (e.g., `components/common/`), add the primary route only (already covered by chrome-verify).

### 3.2 For Each Route

Navigate to `https://localhost:44389<route>` and wait for React hydration (3s):

```
mcp__chrome-devtools__navigate_page(url: "https://localhost:44389<route>")
mcp__chrome-devtools__evaluate_script(script: "new Promise(r => setTimeout(r, 3000))")
```

Run all three smoke checks:

#### a. Console Errors

```
mcp__chrome-devtools__list_console_messages({ types: ["error"] })
```

Filter with SMOKE_TEST.md known patterns. Record pass/fail per route.

#### b. Network Failures

```
mcp__chrome-devtools__list_network_requests()
```

Filter for non-2xx status. Apply SMOKE_TEST.md known filters (status 0, .map 404, OPTIONS).
Record pass/fail per route.

#### c. Layout Integrity (advisory)

```
mcp__chrome-devtools__take_screenshot()
```

Save to `<evidence_dir>/smoke-<route-slug>.png` (e.g., `smoke-bulkprint-create.png`).

```
mcp__chrome-devtools__evaluate_script(script: "JSON.stringify(Array.from(document.images).filter(img => img.naturalWidth === 0 && !img.src.includes('data:') && img.src !== '').map(img => ({src: img.src, alt: img.alt})))")
```

Record result. Layout is **advisory only** — does not fail the run.

### 3.3 Compile Route Sweep Results

```json
{
  "smoke_tests": [
    {
      "route": "/bulkprint/create",
      "console_errors": { "status": "pass", "details": "..." },
      "network_failures": { "status": "pass", "details": "..." },
      "layout": { "status": "pass", "details": "..." }
    },
    {
      "route": "/printOrderHistory",
      "console_errors": { "status": "pass", "details": "..." },
      "network_failures": { "status": "pass", "details": "..." },
      "layout": { "status": "pass", "details": "..." }
    }
  ]
}
```

Always run all three checks on all routes, even if an earlier check fails.

---

## Phase 4: Report — Results + Advance + Inbox

### 4a. Compile Results

Build the results JSON:

```json
{
  "key": "<KEY>",
  "verified_at": "<ISO 8601 now>",
  "branch": "<branch>",
  "results": [ ... AC results from Phase 2 ... ],
  "smoke_tests": [
    {
      "route": "/bulkprint/create",
      "console_errors": { "status": "pass|fail", "details": "..." },
      "network_failures": { "status": "pass|fail", "details": "..." },
      "layout": { "status": "pass|advisory_fail", "details": "..." }
    }
  ],
  "overall": "pass|fail"
}
```

Write to `~/.claude/state/qa-test/<KEY>/results.json`.

### 4b. Determine Overall Result

**Pass criteria:**
- All ACs have status in `[pass, manually_verified]`
- No ACs with status `fail`
- Blocked ACs allowed IF user confirmed out-of-scope (ask if any blocked):
  ```
  AskUserQuestion:
    question: "<N> ACs are blocked. Confirm these are out-of-scope for this PR?"
    options:
      - "Yes, out of scope" / "These blocked ACs don't need to pass for this PR"
      - "No, must fix" / "These are in scope — QA should fail"
  ```
- Console errors smoke test: must pass on ALL swept routes
- Network failures smoke test: must pass on ALL swept routes
- Layout integrity: advisory only on all routes (does not affect overall)

### 4c. Display Results

```
### QA Verification Results — <KEY>

| AC | Status | Notes |
|----|--------|-------|
| AC1: <text> | PASS | <notes> |
| AC2: <text> | FAIL | <notes> |
| AC3: <text> | BLOCKED | <notes> |

### Smoke Tests (Route Sweep)
| Route | Console | Network | Layout |
|-------|---------|---------|--------|
| /bulkprint/create | PASS | PASS | PASS (advisory) |
| /printOrderHistory | PASS | PASS | PASS (advisory) |

### Overall: PASS / FAIL
Evidence: ~/.claude/state/qa-test/<KEY>/
```

### 4d. Advance Pipeline (on pass)

If overall is `pass`:
```
Skill("ticket-state", args: "advance <KEY> qa_verified --note 'QA verified: <N>/<total> ACs passed, <N> smoke tests passed'")
```

### 4e. Write Babysitter Inbox (ALWAYS)

**Always write to inbox**, regardless of outcome:

| Scenario | Error Code | Message |
|----------|-----------|---------|
| All pass | `qa_run_passed` | "QA passed: N/N ACs, 3/3 smoke tests. Advancing to qa_verified." |
| ACs failed | `qa_run_failed` | "QA failed: X/N ACs passed, ACY fail. Stage NOT advanced." |
| Passed with blocks | `qa_run_passed_with_blocks` | "QA passed with N blocked ACs (user confirmed out-of-scope). Advancing." |

```bash
echo '{"at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","skill":"qa-test","error":"<code>","message":"<message>","ticket":"<KEY>"}' >> ~/.claude/state/babysitter/inbox.ndjson
```

---

## Phase 5: Cleanup (FORK — ALWAYS runs)

Regardless of outcome, always fork cleanup to a Task agent:

```
Task(subagent_type: "general-purpose", prompt: "
  Clean up QA test environment for <KEY>:
  1. Run: bash ~/.claude/skills/qa-test/scripts/server-cleanup.sh <KEY>
  2. Close Chrome pages via ToolSearch('select:mcp__chrome-devtools__close_page') then mcp__chrome-devtools__close_page()
  Report: cleanup complete or any errors.
")
```

### Output Final Summary

```
### QA Complete
- **Result:** PASS/FAIL
- **ACs:** N/N passed, N blocked
- **Smoke:** N/N routes passed (N checks each)
- **Evidence:** ~/.claude/state/qa-test/<KEY>/
- **Stage:** <current stage>
- **Next:** <suggestion based on outcome>
```

If pass: "Run `/git pr-create` to open a pull request."
If fail: "Fix the failing ACs and run `/qa-test <KEY> --retest`."

---

## Error Recovery

| Scenario | Handling |
|----------|---------|
| Port 44389 occupied | Kill existing process before starting |
| Server fails to start | Inbox: `dev_server_failed`, cleanup, stop |
| Chrome DevTools unavailable | Inbox: `chrome_devtools_unavailable`, cleanup, stop |
| Chrome disconnects mid-test | Inbox: `chrome_devtools_disconnected`, save partial results, cleanup, stop |
| Screenshot write fails | Inbox: `evidence_write_failed`, continue without screenshot |
| Run exceeds 30 minutes | Inbox: `qa_verification_timeout`, save partial results, cleanup, stop |

For all error scenarios, always run Phase 5 cleanup before stopping.

---

## Activity Logging

Log QA verification events to the central activity stream:

```bash
~/.claude/bin/activity-log.sh qa-test <op> <KEY> [extra]
```

**When to log:**

| Phase | Operation | Extra Fields |
|-------|-----------|--------------|
| Phase 0c (advance to testing) | `start` | `,"stage":"testing"` |
| Phase 2 (AC result) | `ac_pass` or `ac_fail` | `,"ac":"AC<N>","confidence":<0-1>` |
| Phase 4d (advance to qa_verified) | `complete` | `,"pass":<N>,"fail":<N>,"blocked":<N>` |

**Example:**
```bash
~/.claude/bin/activity-log.sh qa-test start POS-3243 ',"stage":"testing"'
~/.claude/bin/activity-log.sh qa-test ac_pass POS-3243 ',"ac":"AC1","confidence":0.92'
~/.claude/bin/activity-log.sh qa-test complete POS-3243 ',"pass":5,"fail":0,"blocked":1'
```
