---
name: people-enrich
description: >
  Enrich memory/people/*.md profiles from the iMessage corpus.
  Extract communication patterns, relationship signals, and life events
  using QMD search and mechanical frontmatter stats.
  Use when enriching a person profile, running people enrichment, or
  analyzing communication patterns with a contact.
argument-hint: "<name> | --tier1 | --discover"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(bun run *)
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
3. Glob `~/code/my-second-brain-v2/memory/people/*.md` for the target
4. The target MUST match exactly one existing person note. If zero or multiple matches, stop and report.

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
4. All existing body content is human-authored unless it already contains `## Enriched Profile`, `## Evidence`, or `## Open Questions` (machine-owned sections)

### Step 4 — Determine Tier

1. Check `roster.json` for tier assignment
2. If not in roster, default to tier 3
3. For the first slice: do not auto-promote or bulk-discover

### Step 5 — Run contact-stats

Run the mechanical stats extractor:

```bash
bun run ~/.claude/skills/people-enrich/scripts/contact-stats.ts --contact "<name>"
```

Read the output JSON from `~/code/my-second-brain-v2/runtime/people-enrichment/<slug>.json`.

### Step 6 — QMD Queries

Run only the dimension set for the resolved tier. Use the QMD MCP tool with `collection: "repo-personal-messages"`.

See [QMD Dimension Query Templates](#qmd-dimension-query-templates) below for the full lookup table.

### Step 7 — AI Analysis

Synthesize QMD results and stats into profile sections.

**Rules:**
- No raw message bodies copied into durable memory
- Prefer short derived summaries and redacted evidence bullets
- Surface uncertainty explicitly in `## Open Questions`
- Keep `## Evidence` to signal-level bullets (e.g., "Discussed X in Jan 2024"), never verbatim quotes

### Step 8 — Merge Proposal

Present the full proposed file as a diff for confirmation.

**First enrichment of an existing note:**

1. Read entire file
2. Split frontmatter from body
3. If the body begins with a top-level `# Name` heading, remove that single H1 before restructuring
4. Wrap remaining existing body content under `## Human Notes`
5. Append machine-owned sections: `## Enriched Profile`, `## Evidence`, `## Open Questions`
6. Add machine-managed frontmatter fields:
   - `person_id` (format: `person_<slug_underscored>`)
   - `slug`
   - `aliases`
   - `source_handles` (nested by source, e.g., `imessage:`)
   - `enrichment` (with `source`, `tier`, `last_run_at`)
7. Preserve all existing frontmatter: `title`, `type`, `status`, `summary`, and any manual fields
8. Update only: `updated`, `summary` (if synthesis improves it), `enrichment`

**Re-enrichment (subsequent runs):**

- Replace only machine-owned sections by `## Heading` match
- Never rewrite or delete `## Human Notes`
- Never remove unmatched manual sections
- Never rename the file without confirmation
- If machine sections already exist, update them in place

### Step 9 — Write

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

## Human Notes
...existing authored content preserved verbatim...

## Enriched Profile
...derived synthesis...

## Evidence
...short signal bullets, not raw logs...

## Open Questions
...uncertainties for manual review...
```

## Section Ownership

| Section | Owner | On Re-run |
|---------|-------|-----------|
| Frontmatter (title, type, status) | Human | Preserve |
| Frontmatter (person_id, slug, source_handles, enrichment) | Machine | Update |
| Frontmatter (summary) | Shared | Update if synthesis improves it |
| `## Human Notes` | Human | Never touch |
| `## Enriched Profile` | Machine | Replace |
| `## Evidence` | Machine | Replace |
| `## Open Questions` | Machine | Replace |
| Any other `## Section` | Human | Preserve |

## QMD Dimension Query Templates

Each template specifies a QMD query parameterized with `{name}`. Use `collection: "repo-personal-messages"` for all queries.

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
