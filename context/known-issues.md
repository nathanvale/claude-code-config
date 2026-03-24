# Known Issues

## Bunx Cache Corruption (MCP Servers)

**Symptom:** MCP servers fail to start with errors like:
```
Cannot find module '@modelcontextprotocol/sdk/server/mcp.js'
```

**Cause:** Bunx caches packages in temp directories that can become corrupted (missing `package.json` files).

**Fix:** Clear the bunx cache for affected packages:
```bash
rm -rf /private/var/folders/_b/*/T/bunx-501-@side-quest/
```

Then restart the AI tool (Codex, Claude Code, etc.) to re-download packages.

## Git-Safety Hook Blocks Inline Python

**Symptom:** `python3 -c "..."` and heredoc (`python3 << 'PYEOF'`) patterns get rejected by the git-safety hook with "Inline interpreter execution cannot be safety-analyzed reliably."

**Workaround:** Write standalone scripts in `scripts/` and call them directly. Never use inline Python (`-c`, `-e`, `--eval`, heredoc) in Bash tool calls.

## VS Code - Minimal Extensions

VS Code runs with only 2 extensions (Night Owl theme + vscode-icons). Previous 68 extensions were backed up to `~/code/dotfiles/vscode-extensions-backup.txt` on 2026-02-21 if Nathan ever needs to find old ones to reinstall.
