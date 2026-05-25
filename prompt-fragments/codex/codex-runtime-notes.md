## Codex-Specific Notes

- **Skills** → Codex discovers skills from repo `.agents/skills/` and user `$HOME/.agents/skills/`.
- **Custom agents** → Codex custom agent definitions live in repo `.codex/agents/` and user `~/.codex/agents/`.
- **Rules** → `~/.codex/rules/*.rules` are Starlark execution-policy rules, not behavioral prompts.
- **Config** → runtime settings in project `.codex/config.toml` and user `~/.codex/config.toml`.
