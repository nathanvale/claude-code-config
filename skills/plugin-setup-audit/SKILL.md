---
name: plugin-setup-audit
description: Audit marketplace plugins against the plugin setup standard and report structural violations for exempt, Tier 1, and Tier 2 plugins.
argument-hint: "[repo-path|--json]"
---

# Plugin Setup Audit

Audit the `side-quest-engineering` marketplace plugins against the canonical setup standard.

## Standard

The audit checks conformance against:

- `/Users/nathanvale/code/side-quest-engineering/docs/specs/plugin-setup-standard.md`

## Default target

If no repo path is provided, audit:

- `/Users/nathanvale/code/side-quest-engineering`

## Usage

Run the checker script:

```bash
bash skills/plugin-setup-audit/scripts/audit-plugin-setup.sh
```

Optional:

- pass a repo path to audit a different checkout
- pass `--json` for machine-readable output

## What it checks

- plugin classification for the known marketplace plugins
- skipped plugins that are explicitly pending removal
- whether required `skills/setup/` files exist
- whether setup skills declare an ownership boundary
- whether required Tier 1 and Tier 2 workflows exist
- whether plugin README files mention the setup surface
- whether plugin metadata exposes `skills: "./skills"` when a setup surface exists

## Output

The checker reports:

- compliant plugins
- violations by plugin
- a non-zero exit code when violations exist
