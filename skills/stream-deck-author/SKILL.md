---
name: stream-deck-author
description: "Author virtual AI Deck layouts: preview or write buttons, icons, pages, and scripts."
role: tool-workflow
---

# Stream Deck Author

Use when the user wants to design, preview, create, or update Stream Deck
layouts, buttons, icons, scripts, or pages through `mcporter`.

Default target: the virtual MCP/AI Stream Deck only.

Do not use for live execution. Hand off existing-action execution to
`skills/stream-deck-use/SKILL.md`.

## Owner Paths

- Authoring MCP server: `https://github.com/verygoodplugins/streamdeck-mcp`.
- Package owner: `https://pypi.org/project/streamdeck-mcp/`.
- Runtime: `uvx streamdeck-mcp`.
- MCP config owner: `/Users/nathanvale/.config/mcporter/mcporter.json`.
- Managed config path: `/Users/nathanvale/code/dotfiles/config/mcporter/mcporter.json`.
- Command schema owner: `mcporter list streamdeck-author --schema --timeout 60000`.
- Execution handoff: `skills/stream-deck-use/SKILL.md`.

## Intent Classification

1. No target given -> **read-only discovery**: inspect config, schema, profiles,
   and current virtual MCP/AI Deck page.
2. Design or preview requested -> read the target page and produce a compact
   proposed layout; do not write.
3. Apply requested -> require explicit approval after preview, back up the page
   directory, write the page, restart Stream Deck, and verify.
4. Execute existing action requested -> hand off to `skills/stream-deck-use/SKILL.md`.

## Workflow

1. Verify local runtime:

```bash
command -v uvx && uvx --version
command -v mcporter && mcporter --version
mcporter config get streamdeck-author
mcporter config doctor
```

2. Verify authoring schema:

```bash
mcporter list streamdeck-author --schema --timeout 60000
```

3. Discover profiles:

```bash
mcporter call streamdeck-author.streamdeck_read_profiles --timeout 30000
```

4. Select the virtual profile whose device model or name contains `AI Stream Deck`,
   `MCP Deck`, or `virtual deck`. If multiple match, ask the user to choose. If
   none match, return blocked: enable MCP Deck in Stream Deck preferences.

5. Read the current target page before planning:

```bash
mcporter call streamdeck-author.streamdeck_read_page \
  --args '{"profile_id":"<profile-id>","directory_id":"<directory-id>"}' \
  --timeout 30000
```

6. Preview mode output:

- Target profile id and page directory id.
- Existing buttons that would be kept, replaced, or cleared.
- Proposed slots, titles, action type, URL/script/app, and icon intent.
- Apply risks: whether Stream Deck must quit/restart and whether shell scripts
  would be created.

7. Apply mode:

- Require explicit user approval after preview.
- Back up the target page directory before writing.
- Call `streamdeck_create_icon` only for approved icon generation.
- Call `streamdeck_create_action` only for an approved exact shell command.
- Call `streamdeck_write_page` with `auto_quit_app=true` only after approval.
- Call `streamdeck_restart_app` after writes.
- Verify with `streamdeck_read_page`.
- Hand off to `skills/stream-deck-use/SKILL.md` for exposed-action verification.

## Home Assistant Gotchas

- Hue room entities do not necessarily expand into member lights. Read the
  room's `entity_id` attribute, expand those ids, and verify the result contains
  physical lights rather than the room entity.
- Hue scene state can trail activation by more than one second. Before capturing
  currently-on lights for a dial action, wait for member states to settle; a
  300 ms Stream Deck tick bucket is not enough.
- Prove active-light dimming with an off member: activate the scene, turn the
  dial, then verify that the off member stayed off and the active members
  changed brightness.
- A physical Stream Deck profile can restore cached actions after an MCP write
  and app restart. Wait for launch, re-read the page, and compare the rendered
  deck; if the app restores stale actions, edit through the Stream Deck UI and
  verify the manifest after the app-owned save.

## Safety

- Never write Codex, Claude Code, OpenCode, VS Code, or `.mcp.json` Stream Deck
  config. Keep Stream Deck MCP server config in mcporter only.
- Default to the virtual MCP/AI Deck. Do not write the physical Stream Deck+
  profile unless the user names that profile explicitly.
- Preview first. Do not write pages, create scripts, install plugins, quit, or
  restart Stream Deck without explicit apply approval.
- Refuse shell-script actions that delete files, read credentials, spend money,
  call billing APIs, carry auth-bearing URLs, or perform irreversible Home
  Assistant service calls.
- Prefer Website/Open URL and app-launch actions for v1.
- Report backup path, profile id, directory id, and verification result after
  apply.

## Tool Map

- Read-only: `streamdeck_read_profiles`, `streamdeck_read_page`.
- Authoring: `streamdeck_write_page`, `streamdeck_create_icon`,
  `streamdeck_create_action`.
- App lifecycle: `streamdeck_restart_app`.
- Plugin support: `streamdeck_install_mcp_plugin`.

Use `mcporter list streamdeck-author --schema --timeout 60000` for exact fields,
flags, and response shapes.

## Next Safe Actions

DX lens: present choices as a short numbered list when user choice changes
target, risk, or write authority. Bold exactly one recommended default.

1. No input or broad ask -> **discover and preview** - read config, schema,
   profiles, and target page; no writes.
2. User asks to build/update -> preview proposed layout first; wait for explicit
   apply approval.
3. User approves apply -> back up, write, restart, verify, then hand off to
   `skills/stream-deck-use/SKILL.md`.
4. Missing virtual deck -> blocked; enable MCP Deck in Stream Deck preferences.

## Verification

- YAML-parse this file after edits.
- `bun run skills/skill-author/scripts/skill-description-audit.ts --json`.
- `bun run skills/skill-author/scripts/check-owner-paths.ts --json`.
- `mcporter config doctor`.
- `mcporter config get streamdeck-author`.
- `mcporter list streamdeck-author --schema --timeout 60000`.
- `mcporter call streamdeck-author.streamdeck_read_profiles --timeout 30000`.
- `mcporter call streamdeck-author.streamdeck_read_page --args '{"profile_id":"<profile-id>","directory_id":"<directory-id>"}' --timeout 30000`.
