---
name: figma
description: "Figma MCP setup, tool discovery, design-to-code workflows, Code Connect, and design system search. Use when Figma is the design source of truth."
role: tool-workflow
---

# Figma

Use when the user asks to fetch Figma designs, set up Figma MCP, sync Code
Connect, generate Figma designs, compare Figma source to implementation, or
search a Figma design system.

Do not use for generic design work without Figma, Storybook-only work, or
direct Figma plugin skill operations (`/figma-use`, `/figma-generate-design`)
that are already working.

## Owner Paths

- Vocabulary: `CONTEXT.md`.
- MCP discovery engine: `mcporter` CLI.
- MCP diagnosis: `skills/mcp-doctor/SKILL.md`.
- State machine: `references/figma-mcp-state-machine.md`.
- Design-to-code workflow: `references/design-to-code-workflow.md`.
- Code Connect workflow: `references/code-connect-workflow.md`.
- Tips and troubleshooting: `references/tips-and-tricks.md`.
- Figma plugin skills: `/figma-use`, `/figma-generate-design`,
  `/figma-generate-library`, `/figma-code-connect` (owned by Figma plugin, not
  this skill).
- Provenance: `PROVENANCE.md`.

## Quick Start

Determine Figma MCP state before doing any Figma work. Read
`references/figma-mcp-state-machine.md` for the full decision tree.

1. Check if `mcp__figma__*` tools are available in the current session with
   ToolSearch query `mcp__figma`.
2. If tools found → state is **ready**; proceed to Pick One.
3. If no tools → check config shape (no secrets):
   - Codex: `codex mcp get figma`
   - Claude: `jq '.mcpServers.figma | {type, url}' ~/.claude.json`
4. If config exists but tools missing → state is **configured-needs-reload**;
   tell user to start a fresh session.
5. If no config → state is **config-missing**; provide the exact config block
   from `references/figma-mcp-state-machine.md`.
6. If mcporter OAuth hangs → state is **mcporter-blocked**; cap at one attempt,
   report the config source being used.

## Pick One

- Need to read a Figma design for implementation → read
  `references/design-to-code-workflow.md`, then call `get_design_context`.
- Need to write to Figma canvas → use `/figma-use` or `/figma-generate-design`
  plugin skills.
- Need to set up Code Connect → read `references/code-connect-workflow.md`.
- Need to search design system → call `search_design_system` or
  `get_libraries`.
- Need to fix MCP setup → run Quick Start states, then hand off to
  `mcp-doctor` if blocked.
- Need to create a new Figma file → call `create_new_file`.
- Need design parity check → read `references/design-to-code-workflow.md`,
  fetch Figma screenshot, compare to implementation or Storybook.

## Research Notes

- Figma MCP exposes 19 tools in two modes: remote
  (`https://mcp.figma.com/mcp`) and desktop
  (`http://127.0.0.1:3845/mcp`).
- Auth: OAuth (Codex/Claude native) or personal access token.
- Config surfaces: Codex (`~/.codex/config.toml`), Claude
  (`~/.claude.json`), mcporter (imports from Claude config by default).
- mcporter sources Figma config from `~/.claude.json` import; Codex OAuth does
  not automatically make mcporter work.
- Code Connect CLI (`@figma/code-connect`): maps codebase components to Figma
  nodes; consumed by `get_code_connect_map` and `get_code_connect_suggestions`
  MCP tools.
- Community alternative: Framelink (`figma-developer-mcp`) — read-only, lower
  token usage, no Dev Mode license required.
- The Figma plugin ships its own skills (`/figma-use`, `/figma-generate-design`,
  `/figma-generate-library`, `/figma-code-connect`). This skill complements
  those by owning setup, routing, and troubleshooting.

## Workflow

1. Parse intent: design read, canvas write, setup/repair, Code Connect, design
   system search, or design parity.
2. Run Quick Start to determine Figma MCP state.
3. If state is not **ready**, stop with the state and next action from
   `references/figma-mcp-state-machine.md`.
4. Identify available runtime: native session tools (`mcp__figma__*`) first,
   mcporter second.
5. Route to the appropriate Pick One workflow.
6. For design-to-code reads, the standard tool combo is:
   `get_design_context` + `get_screenshot` + `get_variable_defs` +
   `get_code_connect_map`.
7. Return terse status line + next action.

## Tool Recipes

```bash
# Check Codex config
codex mcp get figma
codex mcp list

# Check Claude config (shape only, no secrets)
jq '.mcpServers.figma | {type, url}' ~/.claude.json

# mcporter discovery
mcporter list figma --json --verbose --sources --timeout 10000
mcporter list figma --schema --timeout 15000

# mcporter call (when configured and authenticated)
mcporter call figma.get_design_context --args '{"figma_url":"<url>"}'
mcporter call figma.get_screenshot --args '{"figma_url":"<url>"}'
```

For native session tools, use ToolSearch to load schemas then call directly:
```
ToolSearch query "select:mcp__figma__get_design_context,mcp__figma__get_screenshot"
```

## Output Shape

- Start with one status line: state name from the state machine.
- Name the runtime used (native session or mcporter).
- Name the config source.
- Include Figma URLs and node IDs when relevant.
- End with one next action.

```
Figma MCP state: ready

- Runtime: native session (mcp__figma__*)
- Config: ~/.claude.json
- Next action: call get_design_context with the Figma URL.
```

## Rules

- Do not print tokens, OAuth URLs, auth caches, or credential paths.
- Do not loop OAuth more than once per route.
- Always name the config source being used.
- Always name the next safe action.
- Prefer native session MCP tools over mcporter.
- If native tools absent after config changes, explicitly require session
  reload.
- Do not mutate persistent MCP config without user approval.
- Do not kill mcporter daemon processes unless the workflow owns them or user
  approves.
- Hand off MCP diagnosis to `mcp-doctor`; do not reinvent diagnosis logic.
- Hand off canvas operations to Figma plugin skills; do not duplicate their
  workflows.
- Do not guess component mappings; inspect Code Connect data first.
- Do not expose Figma access tokens or OAuth state in any output.

## Verification

- ToolSearch for `mcp__figma` returns tools (when available).
- `codex mcp get figma` or Claude config shows expected shape.
- `mcporter list figma --schema` returns Figma tools (when auth is valid).
- Quick Start produces one of the 6 acceptance states within 60 seconds.
- Changed skill docs pass YAML parse and owner-path checks.

## Next Safe Actions

1. No tools in session → **check config** with Quick Start.
2. Config valid, no tools → **reload session**.
3. Need design read → read `references/design-to-code-workflow.md`.
4. Need Code Connect → read `references/code-connect-workflow.md`.
5. MCP broken → hand off to `mcp-doctor`.
6. Want persistent setup → ask before config writes.
