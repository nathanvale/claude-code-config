# Figma Skill Context

Scoped vocabulary for Figma MCP tool discovery, design-to-code workflows, and
Code Connect mapping.

## Preview Index

- Read `Figma MCP` for tool availability, config sources, and state detection.
- Read `Design Workflows` for design-to-code and Code Connect terms.

## Figma MCP

**Figma MCP state**:
One of six deterministic states from the state machine: `ready`,
`configured-needs-reload`, `needs-auth`, `config-missing`, `mcporter-blocked`,
`access-denied`.
_Avoid_: generic health, partial, unclear status

**Native session tools**:
`mcp__figma__*` tools loaded into the current agent session by the Figma MCP
plugin. Preferred over mcporter when available.
_Avoid_: mcporter tools, plugin tools (ambiguous), Figma API

**Config source**:
The file or system providing Figma MCP configuration: Codex
(`~/.codex/config.toml`), Claude (`~/.claude.json`), or mcporter import.
_Avoid_: auth source, credential store, token location

**mcporter import**:
mcporter's discovery of Figma config from `~/.claude.json`. Codex OAuth does
not automatically flow to mcporter; they are separate auth surfaces.
_Avoid_: shared auth, unified config, synced credentials

## Design Workflows

**Design context**:
Structured layout and styling data returned by `get_design_context` for a Figma
node — the primary read tool for design-to-code work.
_Avoid_: screenshot, metadata, raw API response

**Figma node URL**:
A Figma URL with `node-id` parameter pointing to a specific design element.
Extract the node ID before calling MCP tools.
_Avoid_: file URL (no node), page URL, project URL

**Code Connect**:
Bridge mapping Figma component nodes to codebase components via
`@figma/code-connect` CLI. Once published, the MCP tools
`get_code_connect_map` and `get_code_connect_suggestions` consume the mappings.
_Avoid_: manual component mapping, design tokens, Figma variables

**Design-to-code workflow**:
Agent workflow from a Figma URL to implementation using the standard tool combo:
`get_design_context` + `get_screenshot` + `get_variable_defs` +
`get_code_connect_map`.
_Avoid_: one-shot generation, screenshot-only implementation

**Design parity check**:
Comparison of a Figma design node against an existing implementation or
Storybook story, using screenshot and design context to identify gaps.
_Avoid_: pixel-perfect audit, automated visual regression
