# Figma MCP Tips and Tricks

Known failure modes, recovery paths, and operational notes from real sessions.

## mcporter OAuth Hangs Without Actionable URL

**Symptom:** `mcporter list figma --schema` or `mcporter auth figma` prints
`OAuth authorization required for 'figma'. Waiting for browser approval...` and
never completes. No clickable URL appears.

**Recovery:**
1. Do not retry. Cap at one attempt.
2. Check which config source mcporter is using:
   `mcporter list figma --json --verbose --sources --timeout 10000`
3. If source is `~/.claude.json`, mcporter is using the Claude-side auth flow,
   which is separate from Codex OAuth.
4. Prefer Codex native tools after session reload if Codex auth is valid.
5. If mcporter is the only option, hand off to `mcp-doctor`.

## Codex Config Valid But Session Lacks Tools

**Symptom:** `codex mcp get figma` shows enabled and OAuth complete, but
`tool_search` returns no `mcp__figma` tools.

**Cause:** MCP server config changes do not hot-load into the current Codex
tool list. The session was started before the config was added or auth was
completed.

**Recovery:** Start a fresh Codex session. The new session will load the
configured and authenticated Figma MCP server.

## mcporter Routes to ~/.claude.json Not Codex Config

**Symptom:** mcporter discovers Figma from `~/.claude.json` (import kind:
`claude-code`) even though Codex has its own valid Figma config.

**Cause:** mcporter imports from Claude config by default. It does not read
Codex config.

**Impact:** Codex OAuth success does not make mcporter authenticated. They are
separate auth surfaces.

**Recovery:** For mcporter, auth must go through the Claude/mcporter auth flow.
For Codex sessions, prefer native session tools instead of mcporter.

## Multiple mcporter Daemon Processes

**Symptom:** `ps aux | grep mcporter` shows several
`mcporter daemon start --foreground` processes from different Node install
paths.

**Recovery:**
1. Check active daemon: `mcporter daemon status`.
2. The active daemon is the one with the live socket.
3. Do not kill extra processes unless the user approves and they are clearly
   stale.
4. Restarting the daemon with `mcporter daemon restart` is usually safe but
   does not fix auth issues.

## Config Shape Checks

Safe commands to inspect config without exposing secrets:

```bash
# Codex
codex mcp get figma
codex mcp list

# Claude (shape only)
jq '.mcpServers.figma | {type, url}' ~/.claude.json

# mcporter source
mcporter list figma --json --verbose --sources --timeout 10000
```

Never run:
- `cat ~/.claude.json` (may contain tokens)
- `mcporter auth figma --debug` (may print OAuth state)
- Any command that pipes credential file contents

## Large Figma Pages Exceed Response Caps

**Symptom:** `get_design_context` returns truncated or error response for a
complex page.

**Recovery:** Break the request into component-level selections. Pass a
specific node ID rather than a full page URL.

## Rate Limits

The Figma MCP server uses the Figma REST API under the hood. Heavy sequential
calls may hit rate limits.

**Recovery:** Space out calls. Batch reads where possible (one
`get_design_context` call per component, not per layer).
