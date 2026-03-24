---
title: "Non-Inferable Filter as the Primary Sizing Tool"
type: adr
status: accepted
updated: 2026-03-22
summary: "Why we use the ETH Zurich non-inferable filter to decide what belongs in instruction files, not line counts."
---

# ADR: Non-Inferable Filter as the Primary Sizing Tool

## Status

Accepted (2026-03-22)

## Context

How do you decide what goes into AGENTS.md and what doesn't? Community guidance offers line targets (30-100 lines effective, 200 lines max), but these are arbitrary — a 50-line file full of inferable content is worse than a 120-line file of genuinely useful instructions.

ETH Zurich study (arxiv 2602.11988, Feb 2026) found that:

- Human-written instruction files only marginally improve agent performance (+4%)
- LLM-generated files actually hurt (-2 to -3%) while increasing cost (+20-23%)
- The only instructions that consistently help are things agents **cannot infer from the codebase**

## Decision

Before adding any instruction to AGENTS.md or rules, apply the non-inferable filter:

1. **Can the agent discover this from code, tool schemas, or standard conventions?** → Don't add it
2. **Is this a personal preference, safety rail, or workflow rule with no codebase signal?** → Add it

## Examples

### Passes the filter (belongs in instructions)

- `response_format: "json"` preference — no codebase signal for this
- Plan → Confirm → Execute workflow — personal working style
- ADHD communication preferences — agent can't infer this
- Memory OS ownership model — custom architecture with no code signal
- Key people (Melanie, Levi) — personal context

### Fails the filter (don't add)

- Listing available MCP tool names — agents discover these from tool schemas
- Standard git commands — agents know git
- TypeScript conventions — agents know TypeScript
- File paths that exist in the repo — agents can `ls` and `find`
- Framework-specific patterns — agents infer from existing code

## Consequences

- Line counts are a soft sanity check, not the primary tool
- Adding content requires justifying why the agent can't figure it out on its own
- Keeps the instruction file focused on genuinely valuable guidance
- Avoids the LLM-generated bloat trap that the study found hurts performance

## Re-evaluation

If future studies contradict these findings, or if agent capabilities change significantly (e.g., agents can no longer discover MCP tools from schemas), revisit the filter criteria.
