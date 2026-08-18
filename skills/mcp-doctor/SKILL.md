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
3. For an empty key or `token-missing`, convert the server to the inject pattern
   (below), then re-run the doctor.
4. For `auth-required`, run the printed `mcporter auth <server>` command.
5. For `offline`, check the op session first (`op read <ref>`), then the command/url.

## Inject Pattern

Wire a secret-backed stdio server so the governed launcher delivers the key to
only that process. Nothing in shell profiles or on disk.

```json
"firecrawl": {
  "type": "stdio",
  "command": "/Users/nathanvale/code/dotfiles/bin/with-one-password-token",
  "args": ["inject", "FIRECRAWL_API_KEY",
           "op://API Credentials/FIRECRAWL_API_KEY/credential",
           "--", "bunx", "firecrawl-mcp"]
}
```

The reference lives in `args`, not `env`. The launcher resolves it, removes the
service-account token from the environment, then execs the target, so the child
receives one value and no broker authority.

- Confirm the ref resolves first: `with-one-password-token op item get "<item>" --vault "<vault>" --format json`.
- If the item is missing from 1Password, the doctor stays red; add the secret first.
- `inject` wraps a launched command, so it fits `type: stdio` servers only. An
  HTTP or SSE server has no process to wrap: give it a `headersHelper` that
  prints its headers as JSON, as
  `dotfiles/.claude/skills/dotfiles/references/sensitive-material-access.md`
  describes.

Do not use `op run`. The launcher rejects it because it can forward
`OP_SERVICE_ACCOUNT_TOKEN` to the child, and a config calling `op` directly
bypasses the launcher entirely. A live audit on 2026-08-18 found five such
entries; all were migrated to `inject`.

## Rules

- Run health through the doctor; it preserves the inherited environment while forcing `MCPORTER_NO_KEEPALIVE="*"` for the child `mcporter list` process.
- Treat the guarded `mcporter list` result as the discovery source of truth; do not parse raw config.
- When `mcporter` is missing, report blocked and direct the user to their machine's configured package owner; never auto-install or suggest a second package manager.
- Inject secrets through `with-one-password-token inject`; never paste keys into config, shell profiles, or history.
- In-session MCP tools hold the connection from session start; after a config fix,
  the running session needs reload. `mcporter` spawns fresh, so verify fixes through it.
- The doctor reports across every config source `mcporter` discovers (Claude, Codex, editors).

## Verification

- Run `bun run skills/mcp-doctor/scripts/mcp-doctor.ts --json`; exit 0 means all healthy, 1 means broken, 2 means the doctor itself could not run.

## Next Safe Action

- For triage: run the doctor, fix the highest-value broken server, re-run.
- For a new secret-backed server: confirm the `op://` ref resolves, add the inject block, re-run the doctor.
