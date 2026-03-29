---
name: browser-automation
description: Browser automation recipes -- Chrome connection, agent-browser commands, auth flows, scraping patterns, and reporting formats. Reusable knowledge module for any agent that drives a browser.
user-invocable: false
---

# Browser Automation

Operational knowledge for driving a browser via `agent-browser` CLI. This skill provides recipes and reference material -- the agent that loads it decides what to do with them.

## Chrome Connection

All agents share one real Chrome instance via `connect 9223`. Sessions are **tab namespaces** -- each session tracks its own active tab, but all sessions share one BrowserContext (cookies, localStorage, sessionStorage are shared). Domain partitioning is the safety model: concurrent agents are safe only when they target different domains. For full empirical evidence, see the [executor adapter spec Runtime Binding section](/Users/nathanvale/code/my-second-brain/docs/specs/2026-03-28-browser-executor-adapter.md).

### How agents connect

Each agent connects a named session to the shared Chrome, cleans up stale tabs, then uses `--session` for all subsequent commands:

```bash
# Step 1: Connect named session to shared Chrome
agent-browser --session <name> connect 9223

# Step 2: Clean up stale tabs from previous sessions
agent-browser --session <name> tab list  # close any stale chrome://newtab/ tabs

# Step 3: All subsequent commands use --session only
agent-browser --session <name> tab new <url>
agent-browser --session <name> snapshot
agent-browser --session <name> click @eN
```

- `--session <name>` -- tab namespace (required -- never use the default session)
- `connect 9223` -- attaches to the shared agent Chrome on port 9223
- Use `tab new <url>` -- not `open <url>` -- for parallel safety

### Session Registry

Session names are tracked in `~/.claude/skills/browser-automation/registry.yaml` to prevent naming collisions. The registry owns the connection model and the list of registered session names.

For parallel dispatch of the same agent, callers suffix the session name at runtime (e.g. `--session zoom-1`, `--session zoom-2`). These ephemeral sessions don't need registry entries.

### Config Resolution Order

Config provides auth hints (credential vault, service URLs, identity) -- not Chrome lifecycle. Resolved in this order (first match wins):

1. **Agent explicit** -- `CONFIG_PATH` from the agent's `## Browser Session` section
2. **Project domain-specific** -- `.claude/browser-configs/config.{domain-key}.yaml`
3. **Project generic** -- `.browser-agent.yaml` in project root (legacy -- prefer option 2)
4. **User default** -- `~/.claude/skills/browser-automation/config.yaml`

### Rules

- **NEVER kill Chrome processes** -- `pkill`, `killall`, `kill -9` are all forbidden
- **NEVER run headless** -- always use `--headed`
- **Agents must not run concurrently on the same domain** -- sessions share cookies (no BrowserContext isolation). Tracked upstream: vercel-labs/agent-browser#1068

### Anti-Patterns

| Command | Problem | Use Instead |
|---------|---------|-------------|
| `--auto-connect --session <name>` | 403 -- flags are mutually exclusive | `--session <name> connect 9223` |
| `--session <name> open <url>` (parallel) | `ERR_ABORTED` -- active-tab race | `--session <name> tab new <url>` |
| `--profile ~/.cache/chrome-agent --session <name>` | Spawns Chrome for Testing, 8 windows | `connect 9223` pattern |

## Core Commands Reference

All examples use `--session <name>` (set during connection). If the session is not yet connected, run `agent-browser --session <name> connect 9223` first.

| Command | What it does |
|---------|-------------|
| `agent-browser --session <name> connect 9223` | Connect session to shared Chrome |
| `agent-browser --session <name> tab new <url>` | Open URL in a new tab (parallel-safe) |
| `agent-browser --session <name> snapshot` | Get accessibility tree (primary interface) |
| `agent-browser --session <name> click @eN` | Click element by ref |
| `agent-browser --session <name> fill @eN "text"` | Fill input field |
| `agent-browser --session <name> screenshot /tmp/name.png` | Visual capture |
| `agent-browser --session <name> eval "js"` | Run JavaScript |
| `agent-browser --session <name> wait N` | Wait N milliseconds |
| `agent-browser --session <name> cookies clear --domain "{domain}"` | Clear cookies for domain |

### Tab Namespace Isolation (for parallel runs)

```bash
agent-browser --session agent-a connect 9223
agent-browser --session agent-a tab new <url>
agent-browser --session agent-a snapshot
```

Each `--session` name tracks its own active tab, but **cookies and localStorage are shared** across all sessions (same BrowserContext). Safe for parallel agents only when they target different domains.

## The OBSERVE → REASON → ACT → VERIFY Loop

Every interaction follows this cycle:

1. **OBSERVE** -- `agent-browser --session <name> snapshot` to get current page state
2. **REASON** -- Analyse the snapshot: what elements are present? What should happen next?
3. **ACT** -- Execute ONE action (click, fill, navigate). Never chain multiple actions blindly.
4. **VERIFY** -- `agent-browser --session <name> snapshot` again to confirm the action worked

**Rules:**
- Never fill buttons -- click them
- Refs (`@eN`) change after every DOM mutation -- always get fresh refs from a new snapshot
- Find elements by **role + text content**, not memorised ref numbers
- If an action didn't produce the expected result, log it and try an alternative

## Auth Flows

### Auth Flow Routing

| Config `auth` value | Flow | Section |
|---------------------|------|---------|
| `sso` | Flow A: SSO / Cookie-Based | ### Flow A |
| `password` | Flow B: Password | ### Flow B |
| `password_totp` | Flow C: Password + TOTP | ### Flow C |
| `none` | Skip auth | (proceed directly) |

Sequence: Cookie Check → Auth flow selection → Identity Verification

### Cookie Check (always do this first)

After navigating to any URL, snapshot and check: does the page show the actual content or a login form? If authenticated content is visible, no auth flow needed.

### Identity Verification (after any auth flow)

After authentication completes (whether via cookies or a login flow), verify the logged-in identity matches `config.identity.email`:

1. Look for the logged-in user's email/name in the page snapshot (profile menu, account settings, user avatar)
2. If the identity matches config → proceed with the task
3. If the identity does NOT match → log out, clear cookies for this domain, and re-authenticate with the correct account
4. If identity cannot be determined from the page → proceed but note it in the Browser Report under Issues

```bash
# To clear cookies for a specific domain if wrong account detected:
agent-browser --session <name> cookies clear --domain "{domain}"
```

This prevents silent wrong-account auth when cookies persist from a previous session with a different account.

### Flow A: SSO / Cookie-Based (Google SSO)

For services with `auth: sso` in config:

1. Navigate to the service URL
2. Snapshot -- if login page, look for "Sign in with Google" button
3. Click "Sign in with Google"
4. Fill email from config `identity.email` → click Next
5. If passkey prompt → click "Try another way" → "Enter your password"
6. Get password: `op read "op://{vault}/{op_item}/password"` (vault from config `credentials.default_vault`, op_item from service config)
7. Fill password → click Next
8. If 2FA prompt → click "Google Authenticator"
9. Get TOTP: `op item get "{op_item}" --vault "{vault}" --otp` (TOTP codes expire in ~30 seconds -- always fetch immediately before filling. If expired, retry once with a fresh code.)
10. Fill TOTP → click Next
11. Wait for redirect back to service
12. Verify: snapshot should show authenticated content

### Flow B: Password (Direct Login)

For services with `auth: password` in config:

```bash
USERNAME=$(op read "op://{vault}/{op_item}/username")
PASSWORD=$(op read "op://{vault}/{op_item}/password")
```

Where `{vault}` = config `credentials.default_vault` and `{op_item}` = service's `op_item` field.

1. Navigate to service URL
2. Snapshot to find username/password fields
3. Fill username → fill password → click submit/login
4. Verify: snapshot should show authenticated content

### Flow C: Password + TOTP

For services with `auth: password_totp` in config. Same as Flow B, plus after login submission:

```bash
TOTP=$(op item get "{op_item}" --vault "{vault}" --otp)
```

TOTP codes expire in ~30 seconds. Always fetch immediately before filling. If expired, retry once with a fresh code.

1. Complete Flow B steps
2. If TOTP prompt appears, fill TOTP field → click verify/submit
3. Verify: snapshot should show authenticated content

### Human-in-the-Loop Fallback

When automated auth fails (CAPTCHA, hardware key, unexpected flow):

1. Take a screenshot of the stuck page:

```bash
agent-browser --session <name> screenshot /tmp/browser-agent-needs-human.png
```

2. **Immediately return** a Browser Report with `Status: NEEDS_HUMAN` including:
   - What was tried and what failed
   - Screenshot path (`/tmp/browser-agent-needs-human.png`)
   - What the human needs to do (e.g. "Click the 'Verify you are human' checkbox in the Chrome window")
   - Note: credentials have already been pre-filled if applicable

3. **Do NOT poll or loop.** The sub-agent cannot message the user mid-task. Return the report and let the calling agent relay to the user.

4. After the human completes their part (e.g. solving a CAPTCHA), the calling agent re-dispatches with: "The human has completed their part. Continue the login and task."

5. **On re-dispatch after NEEDS_HUMAN:** The agent should:
   - Snapshot the page to see current state
   - If still on the login page but the blocker is resolved (e.g. CAPTCHA shows "Success!"), **click the submit/login button** to complete the login
   - If a TOTP/2FA prompt appears after login, handle it automatically (see Flow C)
   - Then continue with the original task
   - The human should only need to solve the blocker -- the agent handles everything else

**Why report-and-return:** Sub-agents can only return once. A silent polling loop burns tokens and time without the user knowing what's happening. The cookies persist in `user_data_dir`, so once the human authenticates, subsequent dispatches won't need intervention (typically for weeks).

## Scraping Pattern

1. Navigate to URL
2. Snapshot to get page structure
3. If pagination/tabs exist, click through and snapshot each
4. Extract data from snapshots (text content, not screenshots)
5. Structure into findings

## Gotcha Protocol

### Before Starting

Resolve the gotcha directory relative to the git root (or CWD if not in a git repo):

```bash
GOTCHA_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/docs/gotchas/browser-agent"
```

Look for `${GOTCHA_DIR}/{domain-key}.md`. If found, read the last 60 lines:

```bash
tail -60 "${GOTCHA_DIR}/{domain-key}.md" 2>/dev/null
```

Domain key = simplified domain name (e.g., `tailscale`, `village-cinemas`, `google-flights`, `192-168-0-1`). If no gotcha directory exists in the current project, skip this step.

### When Unexpected Behaviour Occurs

Append an entry to `docs/gotchas/browser-agent/{domain-key}.md`:

```markdown
### {timestamp} - {short description}

**Symptom:** {what happened}
**Cause:** {why it happened, if known}
**Workaround:** {what fixed it}
```

Create the file if it doesn't exist yet (with a YAML frontmatter header).

## Selector Registry

Selector registries let agents reuse validated locator knowledge without hard-coding selectors into prompts. They are an optimization layer, not permission to skip verification.

### Registry Rules

- Treat the selector registry as declarative data only
- Keep executable logic in explicit playbook files or constrained action steps
- Never store snapshot ref IDs in the registry
- Never auto-promote a healed selector on the first recovery run
- Keep human approval boundaries intact even when Fast Mode is available

### Mode Selection

Before acting on a page, decide which mode applies.

**Page fingerprint matching:**
- **FULL match** -- `title_contains` matches AND all `required_text` elements are present in the snapshot
- **PARTIAL match** -- `title_contains` matches but some `required_text` elements are missing
- **NO match** -- `title_contains` does not match

**Mode routing:**

| Fingerprint | Registry + Playbook | Mode |
|-------------|---------------------|------|
| FULL | validated selectors + validated playbook | Fast Mode |
| FULL | missing or candidate | Discovery Mode |
| PARTIAL | any | Recovery Mode (if previously validated) or Discovery Mode |
| NO | any | Discovery Mode |

1. **Discovery Mode**
   Use when no registry exists, the page fingerprint is NO or PARTIAL without prior validation, or no validated playbook exists for the task.
2. **Fast Mode**
   Use only when the fingerprint is FULL and both the selectors and playbook are already validated for the exact task.
3. **Recovery Mode**
   Use when a previously validated selector or playbook step fails at runtime, or a PARTIAL fingerprint on a previously validated page.

### Discovery Mode

Use the normal snapshot-driven loop:

1. Observe page state
2. Discover candidate selectors
3. Perform the action
4. Verify the result

If Discovery Mode uncovers reusable selectors:

- record the candidate selector with evidence
- prefer stable attributes, framework attributes, and label anchoring before positional selectors
- write only validated selectors back to the main registry

### Fast Mode

Fast Mode is a compressed version of the normal loop, not a blind shortcut.

Required conditions:

- registry exists
- page fingerprint matches
- required selectors are marked validated
- playbook exists for the exact task **and has `status: validated`** (not `candidate`)
- prior validation evidence is still applicable

If a playbook is `status: candidate`, use Discovery Mode instead. The candidate script may be run as an assist step, but every field must be individually verified before considering promotion.

Fast Mode flow:

1. Load registry
2. Load playbook
3. Execute the fast path
4. Verify values changed as expected
5. Verify the page is dirty or saveable
6. Save when the task allows it
7. Verify persistence after Save

### Recovery Mode

Recovery Mode handles runtime selector drift without poisoning the shared registry.

When Fast Mode fails:

1. Log which selector or playbook step failed
2. Fall back to snapshot-based discovery for the affected element or step only
3. Record the repaired selector as a candidate with evidence
4. Re-run verification
5. Promote the candidate only after revalidation on a matching fingerprint

### Model Guidance

- Stronger models may use Discovery, Fast, or Recovery Mode
- Cheaper models should use Fast Mode only when the registry and playbook are already validated
- If Fast Mode is unsafe for the cheaper model, return a handoff recommendation instead of pretending the task is impossible

## Browser Report Format

Always return this structure:

```markdown
## Browser Report

**Task:** {what was requested}
**URL:** {url(s) visited}
**Status:** SUCCESS | PARTIAL | FAILED | NEEDS_HUMAN
**Error-Class:** AUTH_FAILURE | SELECTOR_DRIFT | TIMEOUT | CAPTCHA | UNKNOWN | (none)
**Retryable:** yes | no | (n/a)

### Findings
- {structured data or observations}

### Actions Taken
- {numbered steps performed}

### Issues
- {problems encountered, or "(none)"}

### Selectors
- **Mode:** Discovery | Fast | Recovery | (none)
- **Fingerprint:** FULL | PARTIAL | NO | (none)
- **Playbook:** {name}@v{n} | (none)
- **Healed:** {count} selectors | (none)

### New Gotchas
- {gotchas appended, or "(none)"}
```

**Status meanings:**
- `SUCCESS` -- task completed fully
- `PARTIAL` -- task partially completed (e.g., hit 20-command limit, some data retrieved)
- `FAILED` -- task could not be completed
- `NEEDS_HUMAN` -- waiting for manual intervention (auth, CAPTCHA, etc.)
