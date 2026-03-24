---
name: nlm
description: Manage curated NotebookLM workflows from the shared Memory OS using repo-local .nlm.yml config
argument-hint: "[sync|add|query|audio|infographic|report|status|create] [args]"
---

# NotebookLM Hub

Use the shared user-scope NotebookLM workflow.

## Read Order

1. `~/.config/memory/AGENTS.md`
2. `~/.config/memory/docs/notebooklm-operations.md`
3. `~/.config/memory/docs/notebooklm-source-pack-workflow.md`
4. local `.nlm.yml` in the owning repo, if present

## Rules

- Resolve the owning repo before touching NotebookLM.
- Use QMD first when selecting sources.
- Prefer curated source packs over broad uploads.
- Reuse local `.nlm.yml` notebook IDs and presets when available.
- Keep NotebookLM as a synthesis layer, not the source of truth.

## Good Default Pattern

For a pack note like `docs/research/2026-03-16-pri-connect-notebooklm-source-pack.md`:

1. Read the pack note and the owning repo's `.nlm.yml`.
2. Choose the matching notebook.
3. Upload the pack note itself.
4. Upload the files listed in `sources`.
5. Generate the requested artifact.
6. Write any durable conclusions back into Markdown.
