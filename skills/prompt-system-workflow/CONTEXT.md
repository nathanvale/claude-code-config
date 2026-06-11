# Prompt System Workflow

Scoped vocabulary for changing startup instructions: the authoring shape, the topology helper, the setup CLI, and the install artifacts. Cross-cutting startup terms (Startup Surface, Agent runtime, Context path, System of record, Scoped ask-first gate) stay in the root context. Glossary only.

## Language

**Lean authoring**:
Prompt-system shape where one compact canonical instruction source is edited directly, while install or projection tooling handles agent-runtime delivery and drift checks. After migration, retired prompt fragments are not a supported authoring path.
_Avoid_: fragment-first authoring, prompt render system, manual prompt sync

**Instruction topology helper**:
A CLI-shaped control surface that projects, checks, and diagnoses Startup Surface delivery across agent runtimes. It owns delivery health and drift visibility, not instruction authoring.
_Avoid_: prompt generator, render script, install helper, startup authoring tool

**Agent setup CLI**:
Broader install/control surface for wiring agent runtimes across user-scope or repo-scope locations. Use as a separate track from Startup Surface health unless instruction delivery cannot proceed without it.
_Avoid_: instruction topology helper, prompt renderer, repo `AGENTS.md` editor, broad Codex runtime setup by default

**User-scope instruction source**:
Canonical instruction file this repo owns for Nathan's user-scope agent-runtime setup. In this repo, root `AGENTS.md` fills that role while also acting as the repo-local startup file.
_Avoid_: repo-local AGENTS only, prompt fragment source, generated startup file

**Agent runtime appendix**:
Optional tiny agent-runtime-specific Startup Surface addition composed with the shared instruction source during projection. It exists only when a Claude or Codex startup mechanic cannot live cleanly in the shared source, config, or runtime docs.
_Avoid_: prompt fragment, second startup source, generated handbook

**Managed instruction copy**:
Projected Startup Surface file written to an agent-runtime-owned path and checked for drift against the selected runtime check owner. It is an install artifact, not an authoring source or committed generated file.
_Avoid_: manual copy, generated source file, symlink target

