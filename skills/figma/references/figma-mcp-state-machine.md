# Figma MCP State Machine

Six deterministic states. Detect in order; stop at the first match; return the
state and next action.

## Detection Order

### 1. `ready`

**Detection:** ToolSearch for `mcp__figma` returns tools in the current session.

**Next action:** Proceed to Pick One in `SKILL.md`.

### 2. `configured-needs-reload`

**Detection:**
- Config exists (`codex mcp get figma` shows enabled, or
  `~/.claude.json` has `mcpServers.figma`).
- Auth is complete (Codex OAuth succeeded, or mcporter reports no auth error).
- But ToolSearch for `mcp__figma` returns nothing in the current session.

**Next action:** Start a fresh agent session or reload tools. MCP server config
changes do not hot-load into the current tool list.

### 3. `needs-auth`

**Detection:**
- Config exists.
- `mcporter list figma` reports `auth required` without hanging.
- Or `codex mcp get figma` shows the server but OAuth has not been completed.

**Next action:** Run one auth attempt:
- Codex: `codex mcp login figma` (opens browser OAuth).
- mcporter: `mcporter auth figma --timeout 30000`.

Cap at one attempt per route. If auth completes but tools still missing, move
to `configured-needs-reload`.

### 4. `config-missing`

**Detection:**
- `codex mcp get figma` returns not found.
- `~/.claude.json` has no `mcpServers.figma` entry.

**Next action:** Add config. Provide the exact block but do not write it without
user approval.

Codex:
```toml
# ~/.codex/config.toml
[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
```

Claude:
```json
// ~/.claude.json — inside mcpServers
"figma": {
  "type": "http",
  "url": "https://mcp.figma.com/mcp"
}
```

After config is added, auth is still needed → move to `needs-auth`.

### 5. `mcporter-blocked`

**Detection:**
- `mcporter list figma --schema --timeout 15000` hangs with
  `OAuth authorization required for 'figma'. Waiting for browser approval...`
  and no actionable URL is printed.
- Or mcporter routes to `~/.claude.json` import but Claude-side OAuth is
  incomplete while Codex-side OAuth is complete.

**Next action:** Do not retry mcporter OAuth. Instead:
- If Codex config and auth are valid → use Codex native tools after session
  reload.
- If only mcporter is available → report blocked state, suggest
  `mcp-doctor` for deeper diagnosis.
- Name the config source mcporter is using (check `mcporter list figma --json
  --verbose --sources`).

### 6. `access-denied`

**Detection:**
- Figma tools are available and authenticated.
- But calling a tool on the target file/node returns a permission error (403 or
  access denied).

**Next action:** The authenticated user does not have access to this Figma file.
Ask the file owner to share it, or use a different account.

## Auth Attempt Budget

- One Codex auth attempt per session.
- One mcporter auth attempt per session.
- If either hangs or succeeds without exposing tools, stop and report exact
  state.
- Never loop auth. The state machine produces a next action, not a retry.

## Config Shape Checks (Non-Secret)

Safe to read and report:
- Server URL (`https://mcp.figma.com/mcp`)
- Transport type (`http`, `streamable_http`)
- Server name (`figma`)
- Enabled/disabled status
- Config source file path

Never read or report:
- OAuth tokens, access tokens, refresh tokens
- OAuth URLs, state parameters, code challenges
- Auth cache file contents
- Cookie or session values
