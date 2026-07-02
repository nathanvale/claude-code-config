---
name: stream-deck-use
description: "Use Stream Deck MCP Actions through mcporter; diagnose missing Elgato actions."
role: tool-workflow
---

# Stream Deck Use

Use when the user wants an agent to inspect, call, or diagnose Stream Deck MCP
Actions through `mcporter`.

Do not configure Codex, Claude Code, or other MCP clients directly. `mcporter`
is the single MCP configuration surface for this workflow.

Do not use for Stream Deck layout authoring, button creation, icons, scripts, or
profile writes. Hand those requests to `skills/stream-deck-author/SKILL.md`.

## Owner Paths

- Official setup owner: `https://www.elgato.com/ww/en/explorer/products/stream-deck/sd-mcp-setup/`.
- Package owner: `https://www.npmjs.com/package/@elgato/mcp-server`.
- MCP config owner: `/Users/nathanvale/.config/mcporter/mcporter.json`.
- Managed config path: `/Users/nathanvale/code/dotfiles/config/mcporter/mcporter.json`.
- MCP discovery, config checks, and calls: `mcporter` CLI.
- MCPorter docs owner: Context7 `/steipete/mcporter`.
- MCP diagnosis: `skills/mcp-doctor/SKILL.md`.
- Authoring handoff: `skills/stream-deck-author/SKILL.md`.
- Runtime: Node.js 18+; package `@elgato/mcp-server`.
- Stream Deck owner: Stream Deck app 7.4+ with MCP Deck enabled.

## Intent Classification

1. No target given -> **run preflight**: check Stream Deck app state, Node, npm,
   package availability, `mcporter`, and Elgato discovery.
2. Setup requested -> inspect and update only the mcporter config owner path;
   never write client MCP config.
3. Use action requested -> discover tools, pick the described action, then call
   it through `mcporter`.
4. Action descriptions requested -> help write short natural-language
   descriptions for keys in the `MCP Actions` profile.
5. Authoring requested -> hand off to `skills/stream-deck-author/SKILL.md`.
6. Broken or missing tools -> run `mcporter` discovery, then hand off to
   `mcp-doctor` for cross-client diagnosis.

## Workflow

1. Confirm Stream Deck app is open and version is 7.4 or later.
2. Confirm `Preferences -> General -> MCP Deck` is enabled.
3. Confirm actions are on the `MCP Actions` profile. Actions on other profiles
   are intentionally private from AI tools.
4. Confirm every exposed action has a description. Treat descriptions as the AI
   routing surface.
5. Verify local runtime:

```bash
node -v
npm view @elgato/mcp-server name version bin --json
command -v mcporter && mcporter --version
```

6. Verify `mcporter` owns Elgato locally and does not import it from a client:

```bash
mcporter config list
mcporter config list --source import
mcporter config get elgato
mcporter config doctor
```

7. Verify the Elgato tool schema:

```bash
mcporter list elgato --schema --timeout 15000
```

8. If `mcporter` says `Unknown MCP server 'elgato'`, report `config-missing`
   and inspect the current `mcporter` schema/doctor output before adding the
   `elgato` server only to `/Users/nathanvale/.config/mcporter/mcporter.json`.
   Keep exact config fields in the mcporter config owner, not this skill.

9. Discover exposed actions:

```bash
mcporter call elgato.streamdeck__get_executable_actions --args '{}' --timeout 15000
```

10. Execute only a user-approved action id:

```bash
mcporter call elgato.streamdeck__execute_action id:"<action-id>" --timeout 15000
```

## Safety

- Keep destructive, private, billing, credential, and irreversible actions out
  of the `MCP Actions` profile until the user explicitly accepts the risk.
- Do not paste secrets, OAuth state, auth-bearing URLs, or ngrok tokens into
  config or chat.
- Do not enable HTTP, custom ports, ngrok, or direct client MCP config.
- Remove `elgato` from Codex, Claude Code, OpenCode, VS Code, or `.mcp.json`
  configs if found; keep `elgato` only in mcporter local config.
- Do not mutate persistent mcporter config without user approval.
- If Elgato docs show `@elgato/mcp-serverv`, treat it as a vendor-doc typo and
  use `@elgato/mcp-server`.

## Exposed Tools

- `streamdeck__get_executable_actions`: read available described actions.
- `streamdeck__execute_action`: execute one action by `id`.

When `get_executable_actions` returns `[]`, the MCP bridge is working but no
actions are exposed. Check Stream Deck's `MCP Actions` profile and descriptions.

## Gotchas

- Website actions can return `{"status":"ok"}` with little visible change when
  the URL is already open or the browser does not foreground. Verify browser
  tabs or use an action with an obvious side effect before treating execution as
  broken.

## Output Shape

- Start with one status line: `ready`, `config-missing`,
  `configured`, `stream-deck-not-ready`, `mcporter-missing`, or `blocked`.
- Name the runtime used: `mcporter` and `npx`.
- Name the config source inspected or changed.
- End with one next safe action.

## Verification

- `node -v` returns Node 18 or later.
- `npm view @elgato/mcp-server name version bin --json` returns package metadata.
- `mcporter config doctor` reports config health.
- `mcporter config get elgato` shows source `local`.
- `mcporter list elgato --schema --timeout 15000` returns exposed Stream Deck
  tools when configured and Stream Deck is running.
- `mcporter call elgato.streamdeck__get_executable_actions --args '{}' --timeout 15000`
  returns action data or `{"actions":[]}`.
- For broken MCP state, run `bun run skills/mcp-doctor/scripts/mcp-doctor.ts --json`
  from the `claude-code-config` repo root.

## Next Safe Actions

1. First run -> **run preflight** and report state.
2. Config missing -> add `elgato` to the mcporter config owner path only.
3. Tools absent after config -> check Stream Deck MCP Deck, active profile, and action descriptions.
4. Still broken -> hand off to `mcp-doctor`.
