---
name: federated-recall
description: Retrieve context across Markdown repos using the Memory OS rules, preferring QMD when available and direct repo reads as fallback. Use when you need to answer what we already know across work repos, infra repos, and my-second-brain.
argument-hint: [query]
disable-model-invocation: true
---

# Federated Recall

Use the shared Memory OS contract at `~/.config/context/AGENTS.md`.

## Goal

Find the best existing context before creating new notes or asking for synthesis.

## Read Order

1. `~/.config/context/docs/memory-os-contract.md`
2. `~/.config/context/docs/retrieval-and-synthesis.md`
3. `~/.config/context/docs/qmd-federation.md`
4. `~/.config/context/docs/memory-recall-examples.md`
5. `~/.config/context/docs/qmd-query-mode-decision.md`

## Workflow

1. Prefer QMD MCP tools first when they are available in the session.
2. If QMD MCP is unavailable, use the local QMD wrappers:
   - `~/.config/context/scripts/qmd-recall.sh "query"` for lightweight default recall
   - `~/.config/context/scripts/qmd-recall.sh --rich "query"` only as an explicit opt-in
   - `~/.config/context/scripts/qmd-node.sh get ...` for opening a chosen result
3. Use repo paths, filenames, and metadata to narrow the search.
4. Fall back to direct repo reads only when QMD MCP and local QMD CLI are unavailable or incomplete.
5. Report likely source-of-truth locations, not just isolated snippets.

## Output Shape

- Best matches
- Likely owning repo
- Why these results matter
- Whether NotebookLM would help for a richer artifact

## Canonical Prompt Shapes

- "What do we already know about X?"
- "Which repo owns Y?"
- "Find prior decisions about Z."
- "What changed recently about X?"
- "What should I read first to understand X?"

## Rules

- Prefer QMD MCP over shell-based QMD when both are available.
- Prefer local QMD CLI over ad hoc repo grep when MCP is unavailable.
- Prefer the lightweight `qmd-recall.sh` modes before full `qmd query`.
- Do not assume vector-only recall is a lightweight path on this machine.
- Search note bodies as well as metadata.
- Do not treat NotebookLM as the default search tool.
- Keep source-of-truth boundaries explicit in the answer.
