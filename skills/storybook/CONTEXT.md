# Storybook Context

Scoped vocabulary for Storybook MCP workflows, Storybook readiness proof, story
preview, story testing, and Storybook taxonomy work. Glossary only.

## Language

**Storybook readiness proof**:
A runtime-backed check that confirms a local Storybook session is usable for MCP,
previews, and focused story tests before the agent starts Storybook-dependent
work.
_Avoid_: warm-up gate, manual checklist, server smoke test

**Storybook Doctor**:
The skill-owned CLI Front Door (`storybook-doctor` in `src/`) that emits
Storybook readiness proof, structured repair hints, and recovery actions via
`check --json` and `deep --json`. It diagnoses and recommends; it does not
install tools, kill processes, start Storybook, or mutate MCP config. Status,
finding categories, next-action ids, and exit code semantics live in
`src/readiness-model.ts`; the command surface contract lives in
`src/command-contract.ts`.
_Avoid_: Storybook process manager, setup script, tmux installer, MCP server

**Storybook session**:
A running Storybook server at one loopback origin used for MCP calls, previews,
docs lookup, and story tests.
_Avoid_: browser tab, manager page, static build

**Process owner**:
The local mechanism responsible for keeping a Storybook session alive, such as a
repo-owned daemon, tmux session, or attached terminal.
_Avoid_: tmux requirement, background magic, Storybook performance feature

**Storybook MCP endpoint**:
The running Storybook server's `/mcp` endpoint exposed by
`@storybook/addon-mcp`.
_Avoid_: mcporter server, persistent MCP config, remote Storybook config

**Ad-hoc MCP connection**:
A one-run MCP connection to a local Storybook endpoint without writing
persistent MCP configuration.
_Avoid_: installed MCP server, saved config, global setup

**Story preview**:
A user-openable Storybook URL returned for a specific story or variant during
review.
_Avoid_: screenshot, iframe-only URL, manager state

**Focused story test**:
A targeted Storybook test run for affected stories, usually with accessibility
enabled, used as a UI handoff gate.
_Avoid_: full test suite, unit test, visual approval

**Storybook taxonomy**:
The target repo's sidebar and story-title organization language, owned by its
nearest `STORYBOOK_TAXONOMY.md`.
_Avoid_: component folder structure, category guess, skill-owned taxonomy
