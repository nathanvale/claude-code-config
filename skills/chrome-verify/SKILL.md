---
name: chrome-verify
description: Automated browser AC verification using Chrome DevTools MCP. Reads source code, generates dynamic verification scripts, learns from failures.
allowed-tools: Bash, Read, Write, Glob, Grep, ToolSearch, mcp__chrome-devtools__*
user-invocable: false
argument-hint: "verify --key <KEY> --route <route> --acs '<JSON>' --key-files '<JSON>' [--attachments '<JSON>'] [--evidence-dir <path>]"
---

# Task

Verify acceptance criteria in a running browser using Chrome DevTools MCP tools. Fully automated — no user interaction. Reads source code to generate targeted verification scripts.

**Arguments:** `$ARGUMENTS`

Parse from arguments:
- `--key <KEY>` — Ticket key (e.g., POS-3044)
- `--route <route>` — App route (e.g., /bulkprint/create)
- `--acs '<JSON>'` — Array of `{ id, text }` acceptance criteria
- `--key-files '<JSON>'` — Array of source file paths
- `--test-files '<JSON>'` — Array of test file paths (optional)
- `--attachments '<JSON>'` — Array of local file paths for Jira attachments (optional). Typically QA screenshots showing bugs or design discrepancies downloaded by kickoff.
- `--evidence-dir <path>` — Screenshot output directory

## Input Contract

```json
{
  "key": "POS-3044",
  "route": "/bulkprint/create",
  "page_url": "https://localhost:44389/bulkprint/create",
  "evidence_dir": "~/.claude/state/qa-test/POS-3044/screenshots",
  "acceptance_criteria": [
    { "id": "AC1", "text": "When Distributor specific order is selected..." }
  ],
  "key_files": [
    "src/pages/BulkPrintOrders/CreateBulkPrintOrderPage.tsx"
  ],
  "test_files": [
    "src/pages/BulkPrintOrders/SellerFilterHelpers.test.ts"
  ],
  "attachments": [
    "~/.claude/state/tickets/POS-3044/attachments/screenshot-bug.png"
  ]
}
```

## Output Contract

Return EXACTLY this format so the qa-test orchestrator can parse it:

```
### Result
Verified <N> ACs for <KEY>: <pass> passed, <fail> failed, <inconclusive> inconclusive.

| AC | Status | Method | Confidence | Details |
|----|--------|--------|------------|---------|
| AC1 | PASS | browser | 0.92 | ... |

### Context for Caller
- status: pass | partial | fail
- key: <KEY>
- pass_count: <N>
- fail_count: <N>
- inconclusive_count: <N>
- console_errors_total: <N>
- network_errors_total: <N>
- evidence_dir: <path>
- results_file: <path>/chrome-verify-results.json
- new_gotchas: <N>
```

---

## DevExtreme & React Quick Reference

These 8 rules are critical for Chrome DevTools interactions in this app:

1. **Always `take_snapshot` before interaction** — UIDs are ephemeral, regenerated each snapshot
2. **Click combobox UID directly** — not the child button UID
3. **Use `mousedown` + `mouseup` + `click` with `{ bubbles: true }`** for DX list items
4. **Use native input value setter + dispatch `input`/`change` events** for React inputs
5. **Target `overlays[overlays.length - 1]`** for current dropdown (multiple overlays stack)
6. **Wait 2-3s after navigation** for React hydration before any interaction
7. **Use `evaluate_script` for complex checks** — a11y tree is limited for DX virtual lists
8. **Check `dx-state-disabled` class OR `disableable disabled`** in a11y tree for disabled state

---

## Phase 0: Load Context

1. Read GOTCHAS.md from this skill's directory:
   ```
   Read("~/.claude/skills/chrome-verify/GOTCHAS.md")
   ```

2. Parse all arguments from `$ARGUMENTS`

3. Load Chrome DevTools MCP tools (parallel):
   ```
   ToolSearch("select:mcp__chrome-devtools__navigate_page")
   ToolSearch("select:mcp__chrome-devtools__take_snapshot")
   ToolSearch("select:mcp__chrome-devtools__take_screenshot")
   ToolSearch("select:mcp__chrome-devtools__evaluate_script")
   ```

4. Ensure evidence directory exists:
   ```bash
   mkdir -p <evidence_dir>
   ```

---

## Phase 1: Source Analysis (Pre-Browser)

**Goal:** Understand the code to generate targeted verification scripts instead of generic checks.

### 1a. Read Source Files and Attachments

Read all `key_files` and `test_files` using the Read tool. If `attachments` are provided, read image files (`.png`, `.jpg`, `.jpeg`) with the Read tool to load them as visual reference. These are typically QA screenshots showing the bug or design discrepancy that the ticket describes — they represent the "before" or "expected" state to compare against the running app.

For each source file, extract:
- State variables (useState, useSelector, Redux state)
- Handler functions (onClick, onChange, onSubmit)
- Conditional rendering logic (ternaries, && chains, if blocks)
- Component props and their types
- Filtering/transformation functions

### 1b. Map ACs to Code Paths

For each AC, identify:
- Which component renders the UI element described
- Which state variable controls it
- Which function handles the interaction
- What the expected values/states are
- Whether any attachment visually illustrates the expected or broken state for this AC (e.g., a QA screenshot highlighting a design mismatch). If so, note which attachment maps to which AC — this informs what to look for during browser verification.

### 1c. Check Test Coverage

For each AC, scan test_files for direct coverage:
- Does a test assert the exact behavior described in the AC?
- Does it cover the same state transitions?
- Does it test the same edge cases?

If a unit test DIRECTLY and COMPLETELY covers an AC:
- Mark as `test_coverage` method
- Confidence: 0.95
- Skip browser verification for this AC
- Record which test file and test name covers it

### 1d. Generate Verification Scripts

For ACs that need browser verification, generate `evaluate_script` code that:
- Uses knowledge of actual state variable names
- Checks actual DOM selectors from the component code
- Validates expected values from the business logic
- Returns structured `{ pass: boolean, actual: string, expected: string, details: string }`

---

## Phase 2: Navigate and Hydrate

### 2a. Navigate to Page

```
mcp__chrome-devtools__navigate_page(url: "https://localhost:44389<route>")
```

### 2b. Wait for React Hydration

```
mcp__chrome-devtools__evaluate_script(script: "new Promise(r => setTimeout(r, 3000))")
```

### 2c. Initial Evidence

```
mcp__chrome-devtools__take_snapshot()
mcp__chrome-devtools__take_screenshot()
```

Save screenshot to `<evidence_dir>/initial.png`.

### 2d. Initialize Monitoring Watermarks

Record baseline watermarks for per-AC console/network monitoring:

```
mcp__chrome-devtools__list_console_messages({ types: ["error", "warn"] })
→ Record highest msgid as `lastMsgId` (0 if empty)

mcp__chrome-devtools__list_network_requests()
→ Record highest reqid as `lastReqId` (0 if empty)
```

Read `~/.claude/skills/qa-test/SMOKE_TEST.md` known filter patterns for use during AC verification.

---

## Phase 3: Verify Each AC

For each AC that needs browser verification (not already covered by test_coverage):

### 3a-pre. Record Watermarks

Before starting AC verification:

```
mcp__chrome-devtools__list_console_messages({ types: ["error", "warn"] })
→ Record max msgid as `acStartMsgId`

mcp__chrome-devtools__list_network_requests()
→ Record max reqid as `acStartReqId`
```

### 3a. Fresh Snapshot

```
mcp__chrome-devtools__take_snapshot()
```

### 3b. Consult GOTCHAS.md

Check if any gotcha entry is relevant to the component or interaction pattern. If so, adjust the verification script accordingly.

### 3c. Run Verification Script

Execute the dynamically generated script from Phase 1d:

```
mcp__chrome-devtools__evaluate_script(script: "<generated script>")
```

The script must return JSON: `{ pass: boolean, actual: string, expected: string, details: string }`

### 3d. On Failure — Retry Once

If the script fails or returns `pass: false` AND the failure looks like a skill issue (selector not found, timing, stale reference) rather than a genuine AC failure:

1. Navigate to page fresh
2. Wait for hydration (3s)
3. Take fresh snapshot
4. Re-run the verification script

### 3e. On Interaction Failure — Learn

If the failure is a skill issue (selector not found, timing problem, unexpected DOM structure):

Append a new entry to GOTCHAS.md:

```markdown
## <ISO date>: <short description>
- **Component:** <component name>
- **Symptom:** <what went wrong>
- **Fix:** <what worked or what to try next time>
- **Ticket:** <KEY>, <AC ID>
```

Increment `new_gotchas` counter.

### 3f-post. Capture Per-AC Console & Network

After AC verification completes:

1. **Console errors:**
   ```
   mcp__chrome-devtools__list_console_messages({ types: ["error", "warn"] })
   → Filter: msgid > acStartMsgId from 3a-pre
   → Apply SMOKE_TEST.md known filters (remove Redux serialization, etc.)
   → Store remaining as ac_result.console_errors[]
   ```

2. **Network errors:**
   ```
   mcp__chrome-devtools__list_network_requests()
   → Filter: reqid > acStartReqId from 3a-pre
   → Filter: non-2xx status only
   → Apply SMOKE_TEST.md known filters (remove status 0, .map 404, OPTIONS)
   → Store remaining as ac_result.network_errors[]
   ```

3. Update watermarks for next AC (`acStartMsgId`, `acStartReqId` will be re-recorded in next 3a-pre)

### 3f. Capture Evidence Screenshot

```
mcp__chrome-devtools__take_screenshot()
```

Save to `<evidence_dir>/<AC_ID>.png`.

### 3g. Score Confidence

| Scenario | Confidence |
|----------|-----------|
| test_coverage (unit tests cover it) | 0.95 |
| browser + test corroboration | 0.90 |
| browser only, clean pass | 0.85 |
| passed after retry | 0.70 |
| inconclusive (couldn't verify) | 0.50 |

---

## Phase 4: Compile and Return

### 4a. Write Results JSON

Write to `<evidence_dir>/chrome-verify-results.json`:

```json
{
  "key": "<KEY>",
  "verified_at": "<ISO 8601>",
  "results": [
    {
      "ac_id": "AC1",
      "ac_text": "<text>",
      "status": "pass|fail|inconclusive",
      "method": "browser|test_coverage",
      "confidence": 0.85,
      "details": "<details>",
      "screenshot": "<filename>",
      "console_errors": [],
      "network_errors": []
    }
  ],
  "new_gotchas": 0
}
```

### 4b. Report Errors to Babysitter

If any errors occurred during verification, write to babysitter inbox:

```bash
echo '{"at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","skill":"chrome-verify","error":"<code>","message":"<msg>","ticket":"<KEY>"}' >> ~/.claude/state/babysitter/inbox.ndjson
```

Error codes:
- `chrome_verify_connection_lost` — DevTools disconnected mid-run
- `chrome_verify_script_error` — evaluate_script threw an error
- `chrome_verify_nav_timeout` — Navigation timed out
- `chrome_verify_gotcha_added` — New gotcha learned (info severity)

### 4c. Return Structured Output

Output the Result table and Context for Caller block exactly as specified in the Output Contract above. The qa-test orchestrator parses both sections.

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Chrome DevTools disconnected | Write `chrome_verify_connection_lost` to inbox, return partial results |
| evaluate_script throws | Log error, mark AC as inconclusive (confidence 0.50), try next AC |
| Navigation timeout | Write `chrome_verify_nav_timeout` to inbox, return partial results |
| Source file not found | Skip source analysis for that file, use generic verification |
| No test files provided | Skip test coverage analysis, verify all ACs in browser |
| All ACs covered by tests | Return all as test_coverage, skip browser entirely |
