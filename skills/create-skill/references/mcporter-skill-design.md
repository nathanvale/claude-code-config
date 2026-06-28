# MC Porter Skill Design

Use when creating or repairing a skill that wraps MCP tools through the
`mcporter` CLI.

Goal: keep MCP config centralized, schemas discoverable, and skill bodies thin.

## Pattern

- `mcporter` owns MCP config, server startup, schema discovery, and tool calls.
- `SKILL.md` owns intent classification, safety, target choice, and next safe action.
- Exact MCP tool schemas live in `mcporter list <server> --schema`, not copied prose.
- Persistent server definitions live in the named MC Porter config owner path.
- Temporary experiments use ad-hoc MC Porter flags before config becomes durable.

## Owner Checklist

Name these before editing a MC Porter-backed skill:

- Server alias: stable name used by `mcporter`.
- Config owner: path or package that owns the server definition.
- Runtime owner: package or command such as `npx`, `uvx`, or a local command.
- Schema owner: `mcporter list <alias> --schema --timeout <ms>`.
- Read path: first read-only calls and expected state.
- Write path: preview, approval, backup, mutation, and read-back verification.
- Config hygiene: read-only scan for duplicate client MCP config entries.
- Failure modes: missing `mcporter`, missing alias, auth failure, timeout, empty result, or bad schema.

## Command Recipe

Run from the repo root unless the target skill names another working directory.

```bash
mcporter config get <alias>
mcporter config list
mcporter config list --source import
mcporter config doctor
mcporter list <alias> --schema --timeout <ms>
mcporter call <alias>.<tool> --args '<json>' --timeout <ms>
```

Use JSON args for structured values. For large payloads, prefer a file-backed
input path when the target MCP tool supports one.

## Config Hygiene

Use when MC Porter is declared as the single MCP config surface for a workflow.

- Scan client MCP config surfaces read-only by default.
- Check common surfaces: `~/.claude.json`, `~/.claude/`, repo `.mcp.json`,
  `~/.codex/config.toml`, repo `.codex/config.toml`, and named VS Code or
  OpenCode config paths.
- Treat duplicate server aliases or matching server commands as config drift.
- Report exact file path, alias, and redacted command shape.
- Redact env values, tokens, headers, auth-bearing URLs, and secret-like args.
- Remove duplicates only after explicit user approval.
- Leave unrelated MCP servers untouched.
- After approved cleanup, verify with `mcporter config get <alias>`,
  `mcporter config list --source import`, and `mcporter config doctor`.

## Skill Body Checklist

- Put the alias, config owner, schema owner, runtime owner, and safety boundary on the first screen.
- Keep the first safe action read-only unless the skill's whole purpose is a user-approved mutation.
- Separate read-only discovery from mutating apply paths.
- Include config hygiene when MC Porter is the declared single config surface.
- Gate durable writes, external sends, profile writes, app restarts, installs, and shell-script creation behind explicit approval.
- Read back after mutation with the same server or a second trusted read path.
- Report config source, runtime used, target id, changed state, verification result, and next safe action.

## Anti-Patterns

- Writing Codex, Claude Code, VS Code, OpenCode, or `.mcp.json` config when MC Porter is the declared owner.
- Copying full MCP tool schemas into `SKILL.md`.
- Mutating persistent MC Porter config without user approval.
- Removing client MCP config entries without naming exact files and aliases first.
- Mixing execution and authoring when risk surfaces differ.
- Hiding local-only paths, package managers, credentials, auth state, or wrapper scripts.
- Creating shell-script actions without showing the exact command first.
- Treating empty tool results as broken before checking domain setup and permissions.

## Failure Handling

- Missing `mcporter`: report blocked and name the install or wrapper owner.
- Unknown server alias: inspect `mcporter config list`, imports, and the config owner path.
- Auth failure: use the server's auth or wrapper owner; never print secrets or token prefixes.
- Timeout: retry once with a named timeout that matches the server startup cost.
- Empty result: verify domain setup, permissions, selected target, and required descriptions.
- Bad schema or drift: rerun `mcporter list <alias> --schema`; patch skill prose only after owner evidence changes.

## Source Notes

- Context7 `/steipete/mcporter`.
- `pi-mcporter`: `https://pi.dev/packages/pi-mcporter`.
- InfraNodus MCPorter terminal docs: `https://infranodus.com/mcp/deploy-terminal`.
- Arize MCP vs CLI skills eval: `https://arize.com/blog/mcp-vs-cli-skills-for-agents-what-our-eval-found-and-which-you-should-use/`.
- Checked: 2026-06-28.
