---
name: foundry-dx
description: "Run Foundry DX when Claude Code or Codex compaction hooks, auto-compact blocking, handoff packets, or Foundry session recovery diagnostics are needed."
role: tool-workflow
---

# Foundry DX

Use when the user asks about Claude Code or Codex compaction hooks,
auto-compact failures, handoff packets, or Foundry session recovery diagnostics.
Use `lll-account-switch` for switching accounts or editing routing state.

## Owner Map

- CLI package: `runners/foundry-dx/package.json`.
- CLI contract and help: `runners/foundry-dx/src/foundry-dx.mjs`.
- CLI tests: `runners/foundry-dx/src/foundry-dx.test.mjs`.
- Account-routing truth: `$HOME/code/dotfiles/bin/lll-account-switch`.
- Exact hook schema: Claude Code and Codex docs; verify current shape before
  changing hook output.

## Workflow

1. Work from `/Users/nathanvale/code/claude-code-config`.
2. Run the CLI help before changing command usage:
   `bun run foundry-dx -- --help`.
3. Run `status --repo <path>` for routing, health, hooks, and handoff state.
4. Run `doctor --repo <path>` when health should affect the exit code.
5. Run `hooks install --dry-run --force --tool both --block-auto --repo <path>`
   before any hook write.
6. Run the same command without `--dry-run` only when the user wants hook config
   installed.

## Safety

- Treat hook install as a local config write in the target repo.
- Preview hook writes first.
- Keep `--block-auto` on Claude Code Foundry hooks unless the user asks to allow
  auto compaction.
- Do not run repair hints that delete files, clear credentials, or change auth
  without explicit user approval.
- If `lll-account-switch` fails, inspect that owner path before inventing a
  routing fix.

## Output Handling

- Use human output for user status.
- Use `--json` when another agent or script will parse the result.
- Treat `status` as read-only even when it reports health problems.
- Treat `doctor` exit `2` as health-failed, not a CLI crash.
- Read generated handoff files before continuing after compaction.

## Verification

Run from `/Users/nathanvale/code/claude-code-config`:

```bash
bun run --filter @side-quest/foundry-dx typecheck
bun run --filter @side-quest/foundry-dx test
bun run foundry-dx -- hooks install --dry-run --force --tool both --block-auto --repo /Users/nathanvale/code/experience-sdk
```

## Next Safe Action

- If the package is missing, inspect `runners/foundry-dx/package.json`.
- If the target repo is unclear, ask for one repo path.
- If a Foundry session is already stuck at compact `0%`, tell the user to
  restart that session; hooks prevent the next auto-compact hang.
