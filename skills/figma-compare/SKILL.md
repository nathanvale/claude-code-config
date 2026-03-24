---
name: figma-compare
description: Compare Figma designs with running app implementation. Use when comparing UI against Figma mockups, doing visual QA, or when user mentions "compare with Figma" or "match the design".
context: fork
agent: general-purpose
allowed-tools: Bash, mcp__chrome-devtools__*, mcp__plugin_git_git-intelligence__*, Read, Write, Glob, Grep, AskUserQuestion, Skill
argument-hint: [figma-url?] [localhost-path?] [jira-ticket?]
---

# Figma Design Comparison

Compare a Figma design with a running localhost implementation using the Figma REST API and Chrome DevTools.

## Dependencies

This skill delegates Figma API operations to the **figma** building block skill, which handles token validation, seat detection, caching, and rate limit handling.

## Arguments

All arguments are **optional** - the skill will auto-discover from context when not provided.

- `$1` - **Figma URL**: Link to Figma file/frame. Auto-discovered from Jira ticket.
- `$2` - **Localhost route**: Specific route to navigate to (e.g., `/bulkprint/create`). Auto-discovered from Jira context.
- `$3` - **Jira ticket**: Ticket ID (e.g., `POS-2903`). Auto-discovered from git branch name.

**Default localhost base**: `http://localhost:44389`

## Workflow

### 1. Pre-flight checks

1. **Run Chrome cleanup** to kill zombie processes:
   ```bash
   bash ~/.claude/skills/figma-compare/scripts/chrome-cleanup.sh
   ```

2. **Verify Chrome DevTools MCP** is connected:
   - Call `mcp__chrome-devtools__list_pages`
   - If fails, inform user: "Chrome DevTools MCP is not connected. Please ensure Chrome is running with remote debugging."

3. **Create scratch directory** for outputs:
   ```bash
   SCRATCH_DIR=~/.claude/scratch/figma-compare/$(date +%Y%m%d-%H%M%S)
   mkdir -p "$SCRATCH_DIR"
   ```

### 2. Get Jira ticket (REQUIRED - do this first)

**This is the critical first step. Everything else depends on having the Jira ticket.**

1. Use `$3` if provided as argument
2. Extract from git branch name:
   ```bash
   git branch --show-current | grep -oE 'POS-[0-9]+'
   ```
3. **If not found: STOP and ask user immediately**
   - Use `AskUserQuestion` tool
   - Question: "I couldn't find a Jira ticket from the branch name. What ticket is this work for?"
   - Header: "Jira ticket"

Once you have the Jira ticket, use `Skill` tool with `jira` skill to fetch full ticket details: `Skill("jira", args: "view <TICKET-KEY>")`.

### 3. Find Figma URL (from Jira ticket)

**The Jira ticket is the source of truth for Figma links.**

1. Use `$1` if provided as argument
2. Extract from Jira ticket output:
   ```bash
   jira issue view POS-XXXX --plain 2>/dev/null | grep -oE 'https://(www\.)?figma\.com/(design|file)/[^?[:space:]]+' | head -1
   ```
3. **If not found: STOP and ask user**
   - Use `AskUserQuestion` tool
   - Question: "I couldn't find a Figma URL in the Jira ticket. Please provide the Figma link."
   - Header: "Figma URL"

### 4. Find localhost route

Discover the route to navigate to - in order:
1. Use `$2` if provided as argument
2. From Jira ticket: look for route patterns in description/AC
3. From git changes on branch:
   ```bash
   git diff master --name-only | grep -E 'pages/.*\.tsx$'
   ```
   Infer route from file path (e.g., `src/pages/BulkPrint/CreateBulkPrintOrderPage.tsx` → `/bulkprint/create`)
4. **If still not found**: Use `AskUserQuestion` tool

### 5. Get Figma design (3-tier fallback)

Try each tier in order. Stop as soon as one succeeds.

#### Tier A: API export (preferred)

Delegate to the figma building block for frame listing, image export, and design tokens.

```
# List frames
Skill("figma", args: "frames <FIGMA_URL>")
```

From the frames result, select the relevant frame. Then export and extract tokens:

```
# Export image (building block handles caching and seat guard)
Skill("figma", args: "export <FIGMA_URL> --node-id <SELECTED_ID> --output-dir $SCRATCH_DIR")

# Extract design tokens
Skill("figma", args: "tokens <FIGMA_URL> --node-id <SELECTED_ID>")
```

If `can_export=true` and export succeeds → continue to Step 7.

**Also extract tokens regardless of tier** — tokens use Tier 2 (cheaper) and work even when export fails:
```
Skill("figma", args: "tokens <FIGMA_URL> --node-id <SELECTED_ID>")
```

#### Tier A.5: API token extraction (when export unavailable)

If API export fails (`can_export=false`, rate limited, 429, or View/Collab seat) but Tier 2 API is still available:

1. Extract design tokens from the same node(s) used for export:
   ```
   Skill("figma", args: "tokens <FIGMA_URL> --node-id <SELECTED_ID>")
   ```

2. If tokens succeed, carry the structured design properties forward:
   - Typography (font families, sizes, weights)
   - Colors (as CSS rgb values)
   - Dimensions (widths, heights)

3. These properties enable **property-based comparison** in Step 8 even without visual screenshots. Chrome DevTools computed styles can be compared directly against Figma token values.

4. If tokens also fail (Tier 2 rate limited) → fall through to Tier B.

**Note:** Tier A.5 provides structured data, not visual comparison. The comparison report should note "Property-based comparison (no Figma image available)" when using this tier.

#### Tier B: Browser screenshot (when API unavailable)

If both API export and token extraction fail:

1. Navigate Chrome to the Figma URL directly:
   ```
   mcp__chrome-devtools__new_page with url: "<FIGMA_URL>"
   ```

2. Wait for the page to load:
   ```
   mcp__chrome-devtools__wait_for with text: "Figma" timeout: 15000
   ```

3. Take a snapshot to detect login wall:
   ```
   mcp__chrome-devtools__take_snapshot
   ```
   Check snapshot text for login indicators: "Log in", "Sign up", "Enter your email".

4. **If logged in** (no login wall detected):
   - Resize to standard design viewport:
     ```
     mcp__chrome-devtools__resize_page with width: 1440, height: 900
     ```
   - Wait briefly for canvas to render (Figma loads async):
     ```
     mcp__chrome-devtools__wait_for with timeout: 5000
     ```
   - Take screenshot:
     ```
     mcp__chrome-devtools__take_screenshot with filePath: "$SCRATCH_DIR/figma-design.png"
     ```
   - Close the Figma page to avoid tab clutter:
     ```
     mcp__chrome-devtools__close_page
     ```
   - Continue to Step 7.

5. **If login wall detected** → close page, fall through to Tier C.

#### Tier C: User-provided design (last resort)

When both API and browser approaches fail, ask the user to provide the design.

Use `AskUserQuestion`:
- Question: "I can't export from Figma (API rate limited and browser not logged in). How would you like to provide the design?"
- Header: "Figma design"
- Options:
  1. **"I'll paste a screenshot path"** — User provides an absolute file path to a screenshot. Copy it to the scratch dir:
     ```bash
     cp "<user_provided_path>" "$SCRATCH_DIR/figma-design.png"
     ```
  2. **"Let me log into Figma first"** — User logs into Figma in Chrome. After they confirm, retry Tier B.
  3. **"Skip design side"** — Continue with implementation-only audit. Note in the report that Figma design was unavailable and visual comparison was skipped.

### 7. Capture localhost implementation

**Use Chrome DevTools for the implementation side.**

1. Open localhost page:
   ```
   mcp__chrome-devtools__new_page with url: "http://localhost:44389/[route]"
   ```

2. Wait for page to load fully

3. Take screenshots:
   ```
   mcp__chrome-devtools__take_screenshot with filePath: "$SCRATCH_DIR/implementation.png"
   mcp__chrome-devtools__take_screenshot with fullPage: true, filePath: "$SCRATCH_DIR/implementation-fullpage.png"
   ```

4. Take a11y snapshot for text extraction:
   ```
   mcp__chrome-devtools__take_snapshot
   ```

### 8. Compare and analyze

**Visual comparison** (screenshots):
- Layout and positioning
- Overall appearance
- Section order

**Property-based comparison** (from extracted data):
- Text content matches
- Font families and sizes
- Color values (convert Figma 0-1 to CSS 0-255)
- Button and input styling

**Color conversion** (Figma 0-1 → CSS 0-255):
```javascript
const toCSS = (c) => `rgb(${Math.round(c.r*255)}, ${Math.round(c.g*255)}, ${Math.round(c.b*255)})`
```

### 9. Output comparison report

Use the template from [REPORT-TEMPLATE.md](REPORT-TEMPLATE.md).

### 10. Open screenshots

```bash
open "$SCRATCH_DIR/figma-design.png" "$SCRATCH_DIR/implementation.png"
```

## Error Handling

| Error | Solution |
|-------|----------|
| `FIGMA_TOKEN not set` | See `~/.claude/skills/figma/SKILL.md` |
| `403 Forbidden` | Token lacks scopes or file access |
| `404 Not Found` | Invalid file key or node ID |
| `429 Rate Limited` | Falls through to Tier B (browser), then Tier C (user screenshot) |
| Chrome connection fails | Run cleanup script |
| Localhost not running | Start `yarn start:mock` |

### Babysitter Inbox Reporting

On transient failures, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):
- `chrome_devtools_unavailable` — Chrome DevTools MCP not connected during pre-flight
- `figma_export_failed` — Figma frame export fails (delegated to figma building block)
- `localhost_not_running` — Chrome navigation to localhost fails

## Files Created

```
~/.claude/scratch/figma-compare/YYYYMMDD-HHMMSS/
├── figma-*.png          # Exported design frames (Tier A: API, Tier B: browser screenshot)
├── figma-design.png     # Tier B/C: browser screenshot or user-provided screenshot
├── implementation.png
└── implementation-fullpage.png
```
