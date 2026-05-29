# Provenance: peekaboo

Source: [steipete/agent-scripts](https://github.com/steipete/agent-scripts) — `skills/peekaboo/`
License: MIT © 2026 Peter Steinberger (see `LICENSE.upstream`)
Pulled: 2026-05-29 (sparse checkout of `main`)
Binary: peekaboo 3.2.3 via `brew install steipete/tap/peekaboo` → `/opt/homebrew/bin/peekaboo`

## Status: VERBATIM COPY — works; one path note + permissions pending

`SKILL.md` is the unmodified upstream copy. macOS GUI automation CLI (screenshots, UI inspect,
click, type, window control). Pulled to give `browser-use` its attach-prompt recovery path (click
the Chrome "Allow remote debugging?" dialog) and as a general screen-automation tool.

Adapt / verify before relying on it:
- Skill prefers `~/bin/peekaboo` then falls back to `peekaboo` on PATH. Nathan's install is the brew
  path `/opt/homebrew/bin/peekaboo` (the fallback), so it resolves correctly as-is.
- `Docs: ~/Projects/Peekaboo/docs/commands/` is steipete's local path — not present here; use
  `peekaboo learn` / `peekaboo tools --json` for command discovery instead.
- **Permissions not yet granted.** Screenshots need Screen Recording; clicks/typing need
  Accessibility (System Settings > Privacy & Security). Until granted, `permissions status --json`
  will report missing TCC and automation will fail. Grant when first needed.

## Why it's here

Optional recovery path for `browser-use` (GUI-click the CDP attach "Allow" prompt) plus
general-purpose macOS screen automation. Pulled at Nathan's request for full steipete parity.
