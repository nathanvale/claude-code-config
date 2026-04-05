# Workflow: Create Tier 1 setup

## Goal

Create a minimal standard setup surface for a plugin that needs prerequisite checks and state visibility, but no entity-creation workflow.

## Process

1. Create:
   - `skills/setup/SKILL.md`
   - `skills/setup/workflows/check.md`
   - `skills/setup/workflows/show.md`
2. In `SKILL.md`, include:
   - YAML frontmatter with `name: setup`
   - a short purpose statement
   - an ownership boundary section that names what the plugin owns, delegates, or reads externally
   - a routing table for `check` and `show`
3. In `check.md`, describe prerequisite verification for the plugin.
4. In `show.md`, describe how to display current state, config paths, and relevant dependencies.
5. If the plugin relies on delegated shared config or a host-repo contract, say so explicitly instead of inventing plugin-local config.

## Success criteria

- `skills/setup/SKILL.md` exists
- `check.md` and `show.md` exist under `skills/setup/workflows/`
- the ownership boundary is explicit
- the generated structure matches the marketplace setup standard
