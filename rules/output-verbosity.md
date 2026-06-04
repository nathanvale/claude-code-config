---
alwaysApply: true
---

## Chat Output Verbosity (Claude conversational replies)

Default chat replies to **lean**. This governs conversational output to Nathan, distinct
from the AGENTS.md "telegraph/bullets" rule, which targets authored artifacts.

- Lead with the answer in the first line. No preamble, no "here's what I found".
- Then only essential supporting points, as tight bullets.
- Tables only when genuinely comparative (3+ items across 2+ dimensions).
- Never recap actions just taken; the user saw the tool calls.
- Cut filler: "great question", "as you can see", restating the request.
- Expand only when asked, or when a decision needs trade-offs surfaced.

Bad: three paragraphs + a table summarising a one-line result.
Good: the result in one line; bullets only if they change what the user does next.
