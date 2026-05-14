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

## Homebrew Cask Quarantine — 1Password CLI (op)

**Symptom:** `op` binary gets killed or deleted immediately after `brew install 1password-cli`. Running `op` gives `zsh: killed` or `command not found`. The symlink at `/opt/homebrew/bin/op` points to a missing file.

**Cause:** macOS Gatekeeper applies the `com.apple.quarantine` extended attribute to downloaded binaries. The 39MB `op` binary fails or times out during notarization verification and gets removed.

**Fix:** Reinstall and immediately clear the quarantine flag:
```bash
brew reinstall "1password/tap/1password-cli" && xattr -dr com.apple.quarantine /opt/homebrew/Caskroom/1password-cli/*/op
```

Verify with `op --version`.

## VS Code - Minimal Extensions

VS Code runs with only 2 extensions (Night Owl theme + vscode-icons). Previous 68 extensions were backed up to `~/code/dotfiles/vscode-extensions-backup.txt` on 2026-02-21 if Nathan ever needs to find old ones to reinstall.
