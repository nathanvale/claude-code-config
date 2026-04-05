---
name: plugin-scaffold
description: Scaffold a standard setup surface for complex marketplace plugins, including Tier 1 and Tier 2 workflow layouts and ownership boundary documentation.
argument-hint: "[plugin-name]"
---

# Plugin Scaffold

Interactive scaffold for plugins that need a standard `skills/setup/` surface.

## What This Generates

| Tier | Files |
|---|---|
| Tier 1 | `skills/setup/SKILL.md`, `workflows/check.md`, `workflows/show.md` |
| Tier 2 | Tier 1 plus `workflows/add-*.md` and `workflows/configure.md` placeholders |

## Standard

This scaffold follows the marketplace plugin setup contract in:

- `/Users/nathanvale/code/side-quest-engineering/docs/specs/plugin-setup-standard.md`

## Intake

Ask the user:

1. What is the plugin name?
2. Which tier does it need?
   - Tier 1: `check` + `show`
   - Tier 2: Tier 1 plus `add-*` / `configure`
3. What setup ownership model applies?
   - plugin-owned config
   - delegated shared config
   - external host-repo contract
   - mixed
4. Does setup own all setup actions, or does it delegate some workflows to another system?
5. Which path should the scaffold write into?

Wait for answers before proceeding.

## Routing

| Tier | Workflow |
|---|---|
| Tier 1 | `workflows/create-tier1.md` |
| Tier 2 | `workflows/create-tier2.md` |

After writing the scaffold, read `workflows/summary.md`.

## Output requirements

Every generated setup surface must include:

- `skills/setup/SKILL.md`
- a routing table
- an ownership boundary section
- workflow files under `skills/setup/workflows/`
- no secrets in generated config examples

## When not to use this skill

- Do not use for exempt plugins such as simple MCP wrappers or knowledge-only plugins
- Do not use when the plugin needs browser-agent-specific assets such as selectors, playbooks, or session registry wiring; use `browser-automation-scaffold` for those
