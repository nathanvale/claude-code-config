# @side-quest/foundry-dx

Foundry account routing diagnostics and compaction handoff hooks for Claude Code
and Codex.

## Commands

```bash
bun run foundry-dx -- --help
bun run foundry-dx -- status --repo ~/code/experience-sdk
bun run foundry-dx -- hooks install --dry-run --force --tool both --block-auto --repo ~/code/experience-sdk
```

## Owners

- CLI contract: `src/foundry-dx.mjs --help`
- Tests: `src/foundry-dx.test.mjs`
- Account routing truth: `$HOME/code/dotfiles/bin/lll-account-switch`
- Skill driver: `skills/foundry-dx/SKILL.md`
