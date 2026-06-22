# Use Storybook Context

Scoped vocabulary for Storybook MCP workflows, readiness proof, story preview,
story testing, and taxonomy work. Glossary only.

## Language

**Storybook readiness proof**:
Runtime-backed check confirming a local Storybook session is usable for MCP,
previews, and focused story tests before the agent starts Storybook-dependent
work.
_Avoid_: warm-up gate, manual checklist, server smoke test

**Storybook Doctor**:
Skill-owned CLI Front Door (`storybook-doctor` in
`src/front-doors/storybook-doctor/`) that emits readiness proof, structured
repair hints, and recovery actions via `check --json` and `deep --json`.
Diagnoses and recommends; does not install tools, kill processes, start
Storybook, or mutate MCP config. Status, finding categories, next-action ids,
and exit code semantics: `readiness-model.ts`. Command surface contract:
`command-contract.ts`.
_Avoid_: process manager, setup script, tmux installer, MCP server

**Storybook session**:
Running Storybook server at one loopback origin used for MCP calls, previews,
docs lookup, and story tests.
_Avoid_: browser tab, manager page, static build

**Process owner**:
Local mechanism keeping a Storybook session alive — repo daemon, tmux session,
or attached terminal.
_Avoid_: tmux requirement, background magic, Storybook performance feature

**Storybook MCP endpoint**:
Running server's `/mcp` endpoint exposed by `@storybook/addon-mcp`.
_Avoid_: mcporter server, persistent MCP config, remote Storybook config

**Ad-hoc MCP connection**:
One-run MCP connection to a local Storybook endpoint without persistent config.
_Avoid_: installed MCP server, saved config, global setup

**Story preview**:
User-openable Storybook URL returned for a specific story or variant during
review.
_Avoid_: screenshot, iframe-only URL, manager state

**Focused story test**:
Targeted Storybook test run for affected stories, usually with accessibility
enabled, used as a UI handoff gate.
_Avoid_: full test suite, unit test, visual approval

**Storybook taxonomy**:
Target repo's sidebar and story-title organization language, owned by nearest
`STORYBOOK_TAXONOMY.md`.
_Avoid_: component folder structure, category guess, skill-owned taxonomy

**Docs loop**:
Durable, resumable CLI Front Door (`storybook-docs-loop` in
`src/front-doors/storybook-docs-loop/`) for batch Storybook docs cleanup.
Tracks inventory, verification receipts, and batch cursor in XDG state so
agents resume across sessions.
_Avoid_: docs migration script, one-shot audit, manual checklist

**Verification ledger**:
Per-component record of which docs-workflow-checklist fields have been
completed, marked N/A, or blocked. CLI derives item status from ledger state;
agents write receipts via `mark`, not status directly.
_Avoid_: agent-set status, completion flag, manual tracking

**Run card**:
Structured output from `single`, `resume`, or `batch` telling the agent which
cluster files to read, which story-set decisions to make, which verification
receipts to fill, and the next safe action.
_Avoid_: task description, prompt, instruction set

**Component cluster**:
Set of files discovered by inventory for one component: main story, matrix
story, focused stories, nearby specs, README/MDX, and evidence files.
_Avoid_: component folder, story file, single source file
