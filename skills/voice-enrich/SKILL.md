---
name: voice-enrich
description: >
  Use when enriching a person profile with voice transcript data and
  Perel-Baldwin relational writing should be integrated into the note update.
argument-hint: "<name> [--mode rewrite|review|create] [--analyst-report /abs/path.md]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(bun run *), Agent
disable-model-invocation: true
---

# Voice Enrich

Use this when Nathan wants Perel-Baldwin involved in a people-note workflow.

This skill keeps `/people-enrich` lean:
- research stays upstream
- voice stays with `perel-baldwin`
- note mutation stays with `apply-enrichment.ts`

## Defaults

- If `--mode` is omitted and a unique existing enrichment report can be resolved in `runtime/people-enrichment/tmp/`, use `rewrite`
- If `--mode` is omitted and no existing enrichment report exists, use `review`
- `create` must be explicit

## Required Inputs

Always load:
- `~/code/my-second-brain/memory/people/nathan-vale.md`
- target person note at `~/code/my-second-brain/memory/people/<slug>.md`
- `@context/contract-perel-baldwin-context.md`

Optional:
- `~/code/my-second-brain/memory/context/personal.md`
- an explicit `--analyst-report /absolute/path.md`

If the target person note does not exist, stop. This skill is for people-note workflows, not note creation from nothing.

## Mode Selection

### Rewrite

Use when an existing enrichment report already exists at:
- a resolved path inside `~/code/my-second-brain/runtime/people-enrichment/tmp/`

Resolution order:
1. exact `~/code/my-second-brain/runtime/people-enrichment/tmp/<slug>-enrichment-report.json`
2. otherwise, a unique `*-enrichment-report.json` candidate that clearly matches the target name

If multiple candidates match, stop and ask Nathan which artifact to use.

Load output contract:
- `@context/contract-people-note.md`

### Review

Use when Nathan wants critique and suggested rewrites without running the writer.

Load output contract:
- `@context/contract-people-note-review.md`

### Create

Use only when Nathan explicitly asks for a fresh `EnrichmentReport` and provides upstream evidence beyond the note itself.

Good create-mode evidence:
- `--analyst-report /absolute/path.md`
- explicit QMD findings
- explicit psychometrics
- explicit thread or argument summaries

If there is no substantive evidence beyond the note, stop and explain that create mode needs upstream evidence before it is worth running.

Load output contract:
- `@context/contract-people-note-create.md`

## Workflow

### Step 1 - Run The Helper

The operational entrypoint is the thin Bun helper:

```bash
bun run ~/.claude/skills/voice-enrich/scripts/voice-enrich.ts <name> [--mode rewrite|review|create] [--analyst-report /absolute/path.md]
```

What the helper owns:
- resolve the target note deterministically
- select or validate the mode
- resolve the existing enrichment report for rewrite
- build the ContextBundle in deterministic order
- save the bundle artifact for inspection
- dispatch `perel-baldwin` with the bundle as the full allowed context
- save preview artifacts in `runtime/people-enrichment/tmp/`
- run `apply-enrichment.ts` only for JSON-producing modes

### Step 2 - Read The Produced Artifacts

The helper prints machine-readable paths. Read the relevant outputs:
- rewrite: `<stem>-voiced-report.json` and `<stem>-voiced-proposed.md`
- review: `<slug>-review.md`
- create: `<slug>-created-report.json` and `<slug>-created-proposed.md`

### Step 3 - Present The Preview

- For rewrite/create, present a concise diff or change summary from the proposed markdown
- For review, present the markdown review directly
- Do not write the live note without explicit approval

## Safety Rules

- Never bypass the shared writer for JSON-producing modes
- Never write the live note without explicit approval
- Never treat `analyst-report` as stronger than direct note/report evidence
- Never invent create-mode depth from the note alone
- Keep preview artifacts in `runtime/people-enrichment/tmp/`
