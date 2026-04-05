# Workflow: Create Tier 2 setup

## Goal

Create the full standard setup surface for a plugin that needs prerequisite checks, state visibility, and guided creation or configuration workflows.

## Process

1. Run the Tier 1 shape first:
   - `skills/setup/SKILL.md`
   - `skills/setup/workflows/check.md`
   - `skills/setup/workflows/show.md`
2. Add Tier 2 workflow placeholders:
   - `skills/setup/workflows/configure.md`
   - one or more `skills/setup/workflows/add-*.md` files appropriate to the plugin
3. In `SKILL.md`, extend the routing table so the extra workflows are visible and named consistently.
4. For each extra workflow, mark whether setup owns the action directly or delegates it to another system.
5. Keep generated examples secret-free and portable across harnesses.

## Success criteria

- the Tier 1 files exist
- `configure.md` exists
- at least one `add-*` workflow exists
- the routing table and ownership boundary cover every generated workflow
