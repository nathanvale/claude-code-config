# ICA Seam Swarm Orchestration

Use this after routing is settled and before dispatching agents or producing a
prompt pack.

## Table of Contents

- [Context Packet](#context-packet)
- [Orchestrator Preflight](#orchestrator-preflight)
- [Sharding](#sharding)
- [Compression Loop](#compression-loop)
- [Guardrails](#guardrails)

## Context Packet

Before dispatching agents or building prompt packs, create a context packet
that can be copied into every worker prompt:

- **Assessment goal**: the question the swarm must answer and any
  user-specified output needs.
- **Seam under review**: path, conceptual owner, and whether the folder is one
  Seam or several nested seams.
- **Ownership / non-ownership**: concise facts from CONTEXT.md, AGENTS.md,
  package maps, ADRs, or runbooks.
- **Scope lock**: what agents must not inspect deeply, modify, or conclude.
- **Evidence bar**: citation expectations, confidence gate, and whether
  follow-up candidates are in scope.
- **Mode contract**: the selected mode-specific output rule.
- **Output contract**: required sections, optional sections, and formatting
  constraints.

Use the XML-shaped `<context_packet>` contract in [PROMPTS.md](PROMPTS.md).

## Orchestrator Preflight

Before dispatching agents or producing a prompt pack, produce a compact
preflight summary:

- **File list**: exact command used, total file count, excluded
  generated/vendor classes, and any intentionally included lockfiles or
  generated artifacts.
- **Context read**: root and nearest package AGENTS.md, CONTEXT.md,
  package maps, ADRs, runbooks, and why each non-local document constrains the
  seam.
- **Ownership frame**: what the seam owns, what it does not own, and which
  documents are authoritative for those facts.
- **Shard plan**: shard names, focus, write scope of none, and why the shards
  are independent.

For file lists, prefer `rg --files` with explicit exclusions for generated,
vendor, cache, log, and build output. Treat the file list as load-bearing in
worker prompts and synthesis.

For Prompt Pack Only, include the preflight summary compactly as shared prompt
material: complete file list once, file-list command/count/exclusions, context
documents read, ownership frame, and shard plan. Do not include dispatch
readiness claims or full worker prompt bodies unless the user asks for full
prompts. Treat worker prompts as templates plus per-shard deltas; the shared
context packet is the only place for the complete file inventory.

## Sharding

Prefer 3-6 shards when agent dispatch is authorized:

- Full seam pass for the folder.
- Interface width and exported surface.
- Deletion test across every Module.
- Cross-folder leak points and Adapter placement.
- Missing Seam candidates.
- ADR / package constitution conflicts.

Optional shards when requested, or when the seam clearly suggests them:

- ICA Candidate Factory lanes.
- Vocabulary / ubiquitous-language tightening.
- Repetition / DRY audit.
- Ownership ambiguity audit.
- Adversary / weak-finding filter.
- Six-month seam failure pre-mortem.

Each shard must have a distinct focus. Do not ask multiple agents to do the
same broad review. When using optional shards, adapt the worker prompt with the
shard overlays in [PROMPTS.md](PROMPTS.md).

## Compression Loop

Use a compression loop for long or multi-agent swarms:

- After dispatch: record mode, seam, file count, shards, personas, and context
  documents.
- After each agent batch: summarize completed shards, strongest evidence,
  conflicting claims, dropped/weak claims, and remaining gaps.
- Before final synthesis: compress all agent outputs into deduplicated claims,
  candidate backlog, assumptions to verify, and known transitional surfaces.
- On resume: start from the latest compression handoff instead of restarting
  discovery.

Keep compression factual. Preserve evidence and decisions; do not invent new
findings.

## Guardrails

- Read before dispatching. The orchestrator owns prompt quality.
- Complete file lists matter more than clever instructions.
- Keep the assessment read-only.
- Do not ask agents to reveal full chain-of-thought; ask for concise rationale,
  evidence trail, assumptions, confidence, and deletion-test reasoning.
- Do not let one strong finding rationalize every other section.
- Do not promote conclusions into CONTEXT.md, AGENTS.md, package maps, or
  ADRs until the user chooses a follow-up candidate.
