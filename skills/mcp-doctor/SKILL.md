---
name: mcp-doctor
description: "Diagnose broken MCP servers. Use when an MCP tool returns 401, invalid key, or offline, or when checking MCP health across Claude, Codex, and editor configs."
role: quality-gate
---

# MCP Doctor

Turn silent MCP failure into a loud one-line diagnosis. An empty `${ENV}` key
makes a server look configured but dead; this finds it and names the fix.

## Owner Paths

- Health check script: `skills/mcp-doctor/scripts/mcp-doctor.ts`.
- Secret injection owner: `skills/one-password/SKILL.md`.
- Runtime/discovery engine: `mcporter` CLI (`mcporter list`).

## Entry-Screen Route

1. Run `bun run skills/mcp-doctor/scripts/mcp-doctor.ts` for a human report, or
   `--json` for machine output.
2. Read each broken server's `fix` line; apply the smallest one.
3. For an empty key or `token-missing`, convert the server to the op run pattern
   (below), then re-run the doctor.
4. For `auth-required`, run the printed `mcporter auth <server>` command.
5. For `offline`, check the op session first (`op read <ref>`), then the command/url.

## op run Pattern

Wire a secret-backed stdio server so 1Password injects the key into only that
process at launch. Nothing in shell profiles or on disk.

```json
"firecrawl": {
  "type": "stdio",
  "command": "op",
  "args": ["run", "--", "bunx", "firecrawl-mcp"],
  "env": { "FIRECRAWL_API_KEY": "op://API Credentials/FIRECRAWL_API_KEY/credential" }
}
```

- Confirm the ref resolves before editing: `op read "op://API Credentials/<ITEM>/credential"`.
- If the item is missing from 1Password, the doctor stays red; add the secret first.
- op run wraps a launched command, so it fits `type: stdio` servers only. An HTTP
  server with an `Authorization` header has no process to wrap; export the var from
  the shell that starts the MCP host, or front it with a stdio bridge.

## Rules

- Run health through the doctor; it preserves the inherited environment while forcing `MCPORTER_NO_KEEPALIVE="*"` for the child `mcporter list` process.
- Treat the guarded `mcporter list` result as the discovery source of truth; do not parse raw config.
- When `mcporter` is missing, report blocked and name the configured installation owner; never auto-install or suggest a second package manager.
- Inject secrets through `op run`; never paste keys into config, shell profiles, or history.
- In-session MCP tools hold the connection from session start; after a config fix,
  the running session needs reload. `mcporter` spawns fresh, so verify fixes through it.
- The doctor reports across every config source `mcporter` discovers (Claude, Codex, editors).

## Verification

- Run `bun run skills/mcp-doctor/scripts/mcp-doctor.ts --json`; exit 0 means all healthy, 1 means broken, 2 means the doctor itself could not run.

## Next Safe Action

- For triage: run the doctor, fix the highest-value broken server, re-run.
- For a new secret-backed server: confirm the `op://` ref resolves, add the op run block, re-run the doctor.
