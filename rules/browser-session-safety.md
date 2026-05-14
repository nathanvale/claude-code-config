---
alwaysApply: false
globs:
  - "**/browser-agent*"
  - "**/browser-automation*"
  - "**/plugins/browser-automation/**"
  - "**/.claude/agents/*browser*"
  - "**/playbooks/**"
description: Enforces connect + --session isolation for agent-browser commands to prevent window proliferation and session stomping.
---

## Browser Session Safety

The agent-browser daemon is **persistent across all Claude conversations**. The default session is shared and survives indefinitely. Using it will stomp on other agents' work or the user's active browser tabs.

### Rules

- **ALWAYS pass `--session <name>` on every `agent-browser` command** — never use the default session
- **ALWAYS use `connect 9223`** to attach to the shared agent Chrome — do not use `--profile` or `--auto-connect`
- **Session names must come from `~/.config/side-quest/browser-automation/registry.yaml`** — check the registry before inventing a name
- **For parallel dispatch**, suffix the session name: `--session zoom-1`, `--session zoom-2`
- **ALWAYS use `--headed`** — never run headless
- **Agents must not run concurrently on the same domain** — sessions share cookies (no BrowserContext isolation). Two agents on the same domain will see each other's auth state. Tracked upstream: vercel-labs/agent-browser#1068

### Connection Sequence

```bash
# 1. Connect named session to shared Chrome
agent-browser --session <name> connect 9223

# 2. Open pages via tab new (not open) for parallel safety
agent-browser --session <name> tab new <url>
```

### Tab Lifecycle

- **On start:** `agent-browser --session <name> tab list` — close stale `chrome://newtab/` tabs
- **On exit:** `agent-browser --session <name> tab close` tabs this agent created (reverse order)
- **Always leave at least one tab alive** for the next agent

Agents that skip tab cleanup leave orphaned tabs that accumulate indefinitely.

### Standard Sequence

```bash
agent-browser --session <name> connect 9223
agent-browser --session <name> tab new <url>
```

### What NOT To Do

- `agent-browser open https://...` — **NO** — missing `--session`, goes to shared default
- `agent-browser --auto-connect --session <name> ...` — **NO** — flags are mutually exclusive, causes 403
- `agent-browser --profile ~/.cache/chrome-agent --session <name> ...` — **NO** — spawns Chrome for Testing, causes window proliferation (8 windows for 2 sessions)
- `agent-browser --session <name> open <url>` (in parallel) — **NO** — `open` navigates the active tab, causes `ERR_ABORTED` race. Use `tab new <url>` instead
