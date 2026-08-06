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
The skill-owned CLI Front Door (`storybook-doctor` in
`src/front-doors/storybook-doctor/`) that emits
Storybook readiness proof, structured repair hints, and recovery actions via
`check --json` and `deep --json`. It diagnoses and recommends; it does not
install tools, kill processes, start Storybook, or mutate MCP config. Status,
finding categories, next-action ids, and exit code semantics live in
`src/front-doors/storybook-doctor/readiness-model.ts`; the command surface
contract lives in `src/front-doors/storybook-doctor/command-contract.ts`.
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

**Docs loop**:
A durable, resumable CLI Front Door (`storybook-docs-loop` in
`src/front-doors/storybook-docs-loop/`) for batch Storybook docs cleanup across
a component library. Tracks inventory, verification receipts, and batch cursor
in XDG state so agents can resume across sessions.
_Avoid_: docs migration script, one-shot audit, manual checklist

**Verification ledger**:
The per-component record of which docs-workflow-checklist fields have been
completed, marked N/A, or blocked. The CLI derives item status from ledger
state; agents write receipts via `mark`, not status directly.
_Avoid_: agent-set status, completion flag, manual tracking

**Run card**:
The structured output from `single`, `resume`, or `batch` that tells an agent
which cluster files to read, which story-set decisions to make, which
verification receipts to fill, and the next safe action.
_Avoid_: task description, prompt, instruction set

**Component cluster**:
The set of files discovered by inventory for one component: main story, matrix
story, focused stories, nearby specs, README/MDX, and evidence files.
_Avoid_: component folder, story file, single source file
