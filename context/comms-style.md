---
title: "Comms Style"
type: context
status: active
updated: 2026-05-26
summary: "Punctuation rules for outbound human communication (Slack, Teams, email, SMS, wiki)."
---

# Comms Style

Scoped to **outbound human communication** only: Slack, Teams, email, SMS / iMessage drafts on Nathan's behalf, Confluence, Notion, any wiki published to other people. Not a global rule.

Out of scope: source code, code comments, repo markdown, READMEs, skill specs, commit messages, PR descriptions, changelog, Claude Code chat replies, logs, structured output.

## The rule (in-scope only)

- Never use em-dashes (`—`, U+2014) or en-dashes (`–`, U+2013). Nathan hates them in messages he sends.
- Replace with whichever fits:
  - Colon (`:`) when introducing or expanding
  - Comma (`,`) when adding an aside
  - Parentheses (`(...)`) when the aside is a tangent
  - Period + new sentence when the dash hid two thoughts
  - Plain hyphen with spaces (` - `) only when nothing else fits
- Number / letter ranges: write `v1-v8`, `S1-S6`. Never `v1–v8` / `S1–S6`.
- Editing a draft Nathan wrote himself: leave his punctuation alone unless he asks for a scrub.

## Skill enforcement

`draft-message` and `work-message-drafter` treat this as a hard pre-send gate. Other skills (code, docs, commits) ignore it.
