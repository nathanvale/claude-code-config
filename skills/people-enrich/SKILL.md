---
name: people-enrich
description: >
  Enrich memory/people/*.md profiles from the iMessage corpus.
  Extract communication patterns, relationship signals, and life events
  using QMD search and mechanical frontmatter stats.
  Use when enriching a person profile, running people enrichment, or
  analyzing communication patterns with a contact.
argument-hint: "<name> | --tier1 | --discover"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(bun run *), Agent
disable-model-invocation: true
---

# People Enrichment Engine

Enrich `memory/people/*.md` profiles from the iMessage corpus using mechanical stats extraction and QMD-powered dimension analysis.

## Quick Start

```
/people-enrich Richard Johnson
```

## Supported Modes (First Slice)

Only single-contact enrichment of existing known people notes is supported. The target must resolve to exactly one existing `memory/people/*.md` file with unambiguous identity.

**Not yet supported:** `--tier1`, `--discover`, bulk runs, email source.

## Workflow

### Step 1 — Resolve Target

1. Read `$ARGUMENTS` as the target name
2. Look up `roster.json` in this skill directory for handle and tier mappings
3. If no exact match on full name or slug, try first-name fuzzy match against roster entries (e.g., "Ariel" → "Ariel Brott"). Accept only if the first name matches exactly one roster entry.
4. Glob `~/code/my-second-brain/memory/people/*.md` for the target
5. The target MUST match exactly one existing person note. If zero or multiple matches, stop and report.

**Important:** The `--contact` flag on `contact-stats.ts` requires the exact `conversation_with` name from the corpus (e.g., "Ariel Brott", not "Ariel"). Always resolve to the full name before running scripts.

### Step 2 — Resolve Canonical Identity

Follow this precedence strictly:

1. Exact known handle match from `roster.json`
2. Exact `slug` match against person note filename
3. Strong alias match plus overlapping handles
4. **Otherwise: STOP. Return a no-write review result. Never merge on name alone.**

### Step 3 — Read Existing Profile

1. Read the full person note
2. Parse frontmatter and body separately
3. Identify existing sections by `## Heading` boundaries
4. Use the shared writer helpers in `scripts/people-note.ts` to preserve unknown H3 blocks and avoid freehand note rewrites

### Step 4 — Determine Tier

1. Check `roster.json` for tier assignment
2. If not in roster, default to tier 3
3. For the first slice: do not auto-promote or bulk-discover

### Step 5 — Launch Research Sub-Agent

Delegate all heavy corpus work to a sub-agent to keep the main conversation lean. Launch a single `general-purpose` Agent with `run_in_background: true` so the conversation isn't blocked. You'll be notified when it completes — continue chatting with Nathan in the meantime.

Use this prompt structure:

```
You are researching {name} for the People Enrichment Engine.

## Inputs
- Person: {name} (slug: {slug}, tier: {tier})
- Handles: {handles from roster.json}
- Stats JSON path: ~/code/my-second-brain/runtime/people-enrichment/{slug}.json
- Existing profile content: {paste current note body}

## Task 1 — Contact Stats
Check if stats JSON already exists at the path above and is recent (generated_at within 7 days).
- If YES: read it and use it.
- If NO or stale: run `bun run ~/.claude/skills/people-enrich/scripts/contact-stats.ts --contact "{name}"`, then read the output JSON.

## Task 2 — QMD Dimension Queries
Run ONLY the dimension set for tier {tier} from the query table below.
Use `mcp__qmd__query` with `collections: ["repo-personal-messages"]`.

**Critical QMD rules:**
1. Combine lex + vec for best recall: use lex `"{name}"` as first sub-query, vec as second
2. Run queries in PARALLEL batches of 6
3. QMD snippets often show frontmatter, not message content. For the top 3-5 highest-scoring results per dimension, ALWAYS follow up with `mcp__qmd__get` to read the actual message body
4. Use `minScore: 0.3` to filter noise
5. Skip results that are clearly from other people's conversations (check conversation_with field)

{paste the dimension query table for the resolved tier here}

## Task 3 — Synthesize
Produce structured JSON, not prose markdown.

Return this exact shape:

```json
{
  "summary": "Compact retrieval summary",
  "relationship_profile": [
    {
      "heading": "Relationship",
      "content": "Short synthesis for this H3 block."
    }
  ],
  "signals": [
    "Short durable signal bullet"
  ],
  "signal_mode": "append",
  "open_questions": [
    "Concrete uncertainty or review item"
  ],
  "open_questions_mode": "append",
  "conflicts": [
    "Conflict between old manual content and fresh machine evidence"
  ],
  "enrichment": {
    "source": "imessage",
    "tier": 1,
    "last_run_at": "2026-03-22T09:00:00+11:00"
  }
}
```

Field rules:
- `relationship_profile` must be an array of H3 blocks chosen intentionally for the person's `relationship_type`
- `signals` must be concise durable bullets only
- `open_questions` must be concrete and decision-oriented
- `conflicts` is optional, but use it whenever machine evidence conflicts with prior note content. Must be `string[]`, not objects
- Never include raw message text or verbatim quotes
- Default `signal_mode` and `open_questions_mode` to `"append"` for this first slice
- **`summary`:** Omit this field entirely on delta/re-enrichment runs. The summary is a retrieval description of the *person*, not a report on the enrichment run. Only include `summary` on first-time enrichments or when you can write a genuinely better person description than the existing one. Delta summaries like "Minimal delta since X" or "Re-enrichment 2 days after..." will destroy rich existing summaries
- **`enrichment.source`:** Preserve the existing source value if it includes multiple sources (e.g. `imessage+journals`). Only set this field if you are adding a new source, not narrowing an existing one

## Logging
Write a log file at `~/code/my-second-brain/runtime/people-enrichment/{slug}.enrichment.log` as you work.
Log format — one line per entry: `[ISO timestamp] [LEVEL] message`
Levels: INFO, WARN, ERROR

Log these events:
- INFO: task started, stats JSON found/generated, each QMD dimension query completed (with result count), synthesis started, synthesis complete
- WARN: QMD query returned 0 results, stats JSON stale, dimension skipped, cross-contamination detected (wrong conversation_with)
- ERROR: contact-stats script failed, QMD query failed, any unrecoverable issue

This log is read by `/heal` to diagnose issues from background runs.

## Output Rules
- No raw message bodies in the output
- Prefer short derived summaries
- Surface uncertainty explicitly
- Return valid JSON only
- **Never include a `summary` field on delta/re-enrichment runs** — it will overwrite the existing person summary. Only include `summary` on first-time enrichments
- **Never narrow `enrichment.source`** — if the existing note says `imessage+journals`, do not replace it with just `imessage`
- `conflicts` must be `string[]`, not objects — e.g. `"CONFLICT (address): old value vs new value"`
```

The sub-agent returns structured JSON. Read it and proceed to Step 6.

### Step 6 — AI Analysis

Review the sub-agent's report. Refine if needed:
- Verify signal bullets don't contain verbatim quotes
- Check that Open Questions are genuinely uncertain (not just missing data)
- Ensure the chosen H3 blocks are coherent, non-repetitive, and suitable for the person's `relationship_type`

### Step 7 — Merge Proposal

Present the full proposed file as a diff for confirmation.

**Use the shared writer path:**

This skill is the synthesis producer, but it is not a separate people memory system.
`capture` and `productivity-sync` should use the sibling bridge at `~/.claude/skills/people-enrich/scripts/apply-person-update.ts` so every producer writes through the same canonical note contract.

1. Read the entire note
2. Parse it with `scripts/people-note.ts`
3. Resolve identity through `resolvePerson()`
4. Save the sub-agent JSON to a temporary file
5. Run `bun run ~/.claude/skills/people-enrich/scripts/apply-enrichment.ts --note "<person note path>" --report "<temp report path>" --output "<temp proposed path>"`
6. Read the proposed markdown from the temp output path
6. Preserve:
   - unknown manual frontmatter
   - intro text inside `## Relationship Profile`
   - unknown human-authored H3 blocks
   - any extra top-level sections outside the locked contract
7. The shared writer will add or refresh machine-managed frontmatter fields:
   - `person_id` (format: `person_<slug_underscored>`)
   - `slug`
   - `aliases`
   - `source_handles` (nested by source, e.g., `imessage:`)
   - `enrichment` (with `source`, `tier`, `last_run_at`)
8. Update only targeted H3 blocks inside `## Relationship Profile`
9. Append or refresh `## Signals` and `## Open Questions` according to the patch mode in the JSON report

**Important:**

- Never merge on name alone
- Never rename the file without confirmation
- Never replace the whole `## Relationship Profile` wholesale
- Never delete unmatched human-authored H3 blocks
- Never hand-merge machine output into the note when the shared writer can do it deterministically

### Step 8 — Write

Apply approved changes ONLY after Nathan confirms the diff.

## Note Contract

The generated note must match this shape:

```md
---
title: "Richard Johnson"
type: person
status: active
updated: 2026-03-21
summary: "..."
person_id: "person_richard_johnson"
slug: "richard-johnson"
aliases: []
source_handles:
  imessage:
    - "+61497848278"
    - "richard.johnson159@gmail.com"
enrichment:
  source: "imessage"
  tier: 1
  last_run_at: "2026-03-21T..."
---

## Relationship Profile
...existing intro content preserved plus targeted H3 updates...

### Relationship
...derived synthesis...

### Communication Pattern
...derived synthesis...

## Signals
...short signal bullets, not raw logs...

## Open Questions
...uncertainties and review items...
```

## Section Ownership

| Section | Owner | On Re-run |
|---------|-------|-----------|
| Frontmatter (title, type, status) | Human | Preserve |
| Frontmatter (person_id, slug, source_handles, enrichment) | Machine | Update |
| Frontmatter (summary) | Shared | Update if synthesis improves it |
| `## Relationship Profile` intro | Human | Preserve |
| `## Relationship Profile` H3 blocks | Shared | Upsert targeted blocks only |
| `## Signals` | Shared | Append or replace via patch mode |
| `## Open Questions` | Shared | Append or replace via patch mode |
| Any other `## Section` | Human | Preserve |

## QMD Dimension Query Templates

Each template specifies a QMD query parameterized with `{name}`. Use `collections: ["repo-personal-messages"]` for all queries.

### Query Execution Rules

1. **Always combine lex + vec** for best recall. Use `lex` with `"{name}"` as the first sub-query (exact name match, gets 2x weight), and `vec` as the second sub-query (semantic meaning).
2. **Run queries in parallel batches of 6** to avoid sequential slowness.
3. **QMD snippets often show frontmatter metadata, not message content.** For the top 3-5 highest-scoring results per dimension, ALWAYS follow up with `mcp__qmd__get` to read the actual message body.
4. **Use `minScore: 0.3`** to filter low-confidence noise.
5. **Skip cross-contamination** — check `conversation_with` field matches the target before using a result as evidence.

### Tier 1 Dimensions (30 queries — core relationships)

| # | Dimension | Query Type | Query Text | Limit | Intent |
|---|-----------|-----------|------------|-------|--------|
| 1 | Relationship type | vec | "relationship between Nathan and {name}" | 10 | Classify the relationship |
| 2 | How they met | vec | "how Nathan met {name}" | 5 | Origin story |
| 3 | Shared interests | vec | "{name} hobbies interests activities" | 10 | Common ground |
| 4 | Emotional tone | vec | "emotional conversations between Nathan and {name}" | 10 | Sentiment baseline |
| 5 | Volume | — | _from contact-stats_ | — | — |
| 6 | Timing | — | _from contact-stats_ | — | — |
| 7 | Topics discussed | vec | "{name} topics conversations subjects" | 15 | Topic inventory |
| 8 | Initiative | — | _from contact-stats_ | — | — |
| 9 | Life events | vec | "{name} birthday wedding baby job move house" | 10 | Key milestones |
| 10 | Support given | vec | "Nathan helped {name} support advice" | 8 | Giving patterns |
| 11 | Support received | vec | "{name} helped Nathan support advice" | 8 | Receiving patterns |
| 12 | Conflict | vec | "{name} argument disagreement sorry frustrated" | 5 | Tension signals |
| 13 | Plans together | vec | "plans with {name} meetup dinner catch up" | 10 | Future-facing activity |
| 14 | Recurring events | — | _from contact-stats (monthly patterns)_ | — | — |
| 15 | Gifts/celebrations | vec | "{name} birthday gift present celebration" | 5 | Generosity signals |
| 16 | Family mentions | vec | "{name} family kids partner parent" | 8 | Family context |
| 17 | Work context | vec | "{name} work job career project" | 8 | Professional context |
| 18 | Health mentions | vec | "{name} health doctor sick hospital" | 5 | Wellbeing signals |
| 19 | Travel together | vec | "{name} travel trip holiday flight hotel" | 8 | Shared experiences |
| 20 | Money/logistics | vec | "{name} money pay cost logistics" | 5 | Practical patterns |
| 21 | Humor/inside jokes | vec | "{name} funny joke laugh haha lol" | 5 | Bonding signals |
| 22 | Advice seeking | vec | "{name} what do you think advice opinion" | 8 | Trust indicator |
| 23 | Vulnerability | vec | "{name} worried scared anxious stressed" | 5 | Depth indicator |
| 24 | Boundaries | vec | "{name} busy can't sorry later" | 5 | Boundary patterns |
| 25 | Growth observed | vec | "{name} changed different better progress" | 5 | Evolution |
| 26 | Communication style | vec | "how {name} communicates writing style" | 5 | Style notes |
| 27 | Reliability | vec | "{name} promised forgot cancelled late" | 5 | Follow-through |
| 28 | Introductions | vec | "{name} introduced meet know" | 5 | Network effects |
| 29 | Seasonal patterns | — | _from contact-stats (monthly_volume)_ | — | — |
| 30 | Relationship trajectory | vec | "{name} recent messages latest conversations" | 10 | Current state |

### Tier 2 Dimensions (12 queries — regular contacts)

Use dimensions: 1, 3, 5, 6, 7, 8, 9, 13, 16, 17, 19, 30

### Tier 3 Dimensions (5 queries — peripheral contacts)

Use dimensions: 1, 5, 6, 7, 9

## Fixtures

Reference fixtures for merge verification:

- [fixtures/richard-johnson.before.md](fixtures/richard-johnson.before.md) — Profile before enrichment
- [fixtures/richard-johnson.after.md](fixtures/richard-johnson.after.md) — Expected shape after enrichment

## Files

| File | Purpose |
|------|---------|
| `roster.json` | Tier assignments and handle-to-person mappings |
| `scripts/contact-stats.ts` | Mechanical frontmatter stats extractor |
| `scripts/lib.ts` | Shared parser and helpers |
| `scripts/contact-stats.test.ts` | Test coverage |
| `scripts/tsconfig.json` | Bun TypeScript config |
| `fixtures/*.md` | Merge verification fixtures |

## Success Criteria

- [ ] Existing human-authored content survives enrichment intact
- [ ] Machine sections are clearly demarcated and replaceable
- [ ] No raw message bodies appear in durable memory
- [ ] Re-running enrichment is idempotent (no duplicate sections, no content churn)
- [ ] Ambiguous identity produces a no-write review path
- [ ] Stats JSON exists at `runtime/people-enrichment/<slug>.json` before enrichment runs
