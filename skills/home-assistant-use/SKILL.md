---
name: home-assistant-use
description: "Use Home Assistant through mcporter for live home state, lights, blinds, climate, scripts, or MCP diagnosis."
role: tool-workflow
---

# Home Assistant Use

Use when the user wants an agent to inspect or control Home Assistant through
`mcporter`.

Do not use for Home Assistant rebuilds, integration setup, dashboard design, or
container administration unless the user asks for system work.

## Owner Map

- Server alias: `home-assistant`.
- Current config source: `mcporter config get home-assistant`, local from
  `/Users/nathanvale/.config/mcporter/mcporter.json`.
- Durable mcporter config owner: `/Users/nathanvale/.config/mcporter/mcporter.json`.
- Managed config path: `/Users/nathanvale/code/dotfiles/config/mcporter/mcporter.json`.
- Runtime owner: `/Users/nathanvale/code/dotfiles/bin/home-assistant-mcp`.
- Runtime engine: `/opt/homebrew/bin/uvx mcp-proxy`.
- Secret owner: `op://API Credentials/HOME_ASSISTANT_AGENT_TOKEN/credential`.
- Schema owner: `mcporter list home-assistant --schema --timeout 60000`.
- Live setup owner:
  `/Users/nathanvale/code/my-second-brain/context/services/home-assistant.md`.
- MCP diagnosis owner: `skills/mcp-doctor/SKILL.md`.

## Intent Classification

1. No target given -> **run preflight** and report the exposed live control
   surface without changing devices.
2. Current state requested -> call `GetLiveContext` and answer from live state.
3. Specific device action requested -> read live context, resolve one exposed
   target, call the matching tool through `mcporter`, then read back.
4. Broad, ambiguous, risky, or setup request -> stop at diagnosis or a
   confirmation gate before any write.

## Workflow

1. Verify mcporter and config source from the repo root:

```bash
command -v mcporter && mcporter --version
mcporter config get home-assistant
mcporter config doctor
mcporter list home-assistant --schema --timeout 60000
```

2. Read live exposed state first:

```bash
mcporter call home-assistant.GetLiveContext --args '{}' --timeout 60000
```

3. Resolve the target from live names, areas, and domains. If more than one
   match is plausible, ask one short question.
4. For writes, state the target, tool, and intended state. Proceed only when the
   current user turn already requested that exact action, or after confirmation.
5. Call through `mcporter`, then read live context again to verify.

Examples are illustrative; inspect the schema owner before relying on fields:

```bash
mcporter call home-assistant.HassLightSet \
  --args '{"name":"Hallway","brightness":50}' \
  --timeout 60000

mcporter call home-assistant.HassSetPosition \
  --args '{"name":"Living Room Blinds","position":50}' \
  --timeout 60000

mcporter call home-assistant.HassClimateSetTemperature \
  --args '{"name":"Bedroom AC","temperature":24}' \
  --timeout 60000
```

## Safety

- Keep agent control on the local/private MCP path. Do not route writes through
  public `ha.myagentdojo.com`.
- Never print token values, token prefixes, auth-bearing URLs, or 1Password
  output.
- Treat live Home Assistant actions as real-world writes.
- Do not run whole-home actions, bedroom or child-room changes, blinds,
  climate writes, scripts, or timers unless the current turn explicitly asks for
  that action.
- Stop when the requested entity is absent from `GetLiveContext`; do not invent
  entity IDs or bypass Assist exposure.
- Do not edit mcporter config, Codex config, wrapper scripts, HA YAML, or Docker
  state without explicit user approval.
- After every write, verify with `GetLiveContext` and report the observed state.

## Config Hygiene

Use read-only scans before setup changes:

```bash
mcporter config list
mcporter config list --source import
mcporter config get home-assistant
mcporter config doctor
```

If config ownership changes are requested, name duplicate sources before edits.
Do not remove or rewrite Codex, Claude, VS Code, OpenCode, or repo MCP config
entries outside the requested cleanup scope.

## Failure Modes

- `mcporter-missing` -> report blocked and install or PATH owner.
- `unknown-alias` -> inspect config lists and mcporter config sources.
- `auth-failed` -> check the wrapper, 1Password item, and `op` readiness; do not
  print secrets.
- `endpoint-missing` -> check Home Assistant `mcp_server` and `/api/mcp` on the
  private LAN endpoint.
- `empty-surface` -> check Assist exposure, user permissions, and the explicit
  allowlist.
- `ambiguous-target` -> ask one question with the candidate names.
- `write-unverified` -> read back with `GetLiveContext` before reporting done.

## Output Shape

- Start with one status: `ready`, `changed`, `needs-confirmation`, `blocked`, or
  `degraded`.
- Name runtime: `mcporter`.
- Name config source from `mcporter config get home-assistant`.
- Name target, action, and read-back state when a write runs.
- End with one next safe action.

## Verification

- `command -v mcporter && mcporter --version`.
- `mcporter config get home-assistant`.
- `mcporter config doctor`.
- `mcporter list home-assistant --schema --timeout 60000`.
- `mcporter call home-assistant.GetLiveContext --args '{}' --timeout 60000`.
- After a write, rerun `GetLiveContext` and confirm observed state changed or
  report the mismatch.

## Next Safe Actions

DX lens: present choices as a short numbered list so the user can reply by
number. Bold the recommended default. Never present more than 4 options.

1. No specific target -> **run preflight** and show exposed live controls.
2. State question -> read `GetLiveContext` and answer from current state.
3. Specific control request -> resolve target, call mcporter, then read back.
4. Broken or setup request -> run config diagnosis; ask before persistent edits.
