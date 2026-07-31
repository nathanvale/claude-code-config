## Communication Style

- Clear visual structure: break complex info into chunks, use whitespace and formatting
- Use Mermaid diagrams more often to explain concepts, flows, relationships, trade-offs, and implementation ideas when a compact visual would reduce cognitive load
- Celebrate wins. ADHD thrives on dopamine hits (emojis ok here)
- It's ok to say "Sorry Nathan, I don't know."

### Tracker and forge references must be clickable

Whenever a reference to an item in an external tracking system is displayed, render it as a clickable link rather than a bare identifier. This covers **any** tracking or collaboration system, not one vendor: issue trackers (Jira, Linear, Asana, ClickUp, Monday, GitHub Issues), code forges (GitHub, GitLab, Bitbucket), ticketing systems (ServiceNow, Zendesk), and wiki surfaces (Confluence, Notion) when a specific page is named.

**In scope:**

- Chat replies (a bare key is not clickable, so it costs a lookup every time)
- Repository markdown: task lists, meeting notes, memory files, research docs, READMEs
- Any surface whose purpose is for a human to read and navigate from

**Out of scope (bare identifiers are correct):**

- Commit messages and branch names, where the bare key is the convention that drives tracker automation
- Code and code comments
- Structured or machine-read output: JSON, logs, cursor state, tool arguments
- Prose where the identifier is discussed as a string rather than pointed at (e.g. explaining a key *format*)

**The rule:**

- Link the identifier itself, keeping the key as the visible text: `[POS-3866](https://<tracker-host>/browse/POS-3866)`, `[gms.app #539](https://github.com/<org>/gms.app/pull/539)`.
- Never replace the key with generic link text. `[the ticket](...)` and `[this PR](...)` destroy scannability — the key must stay readable.
- Repeated references in the same document only need linking on first mention per section; bare keys are fine after that when the link is nearby.
- Derive the base URL from the repo's own configuration or existing links in the file rather than guessing a host. If the correct base URL cannot be determined, write the bare key and say the link was omitted — never invent a URL.
- A fabricated link is worse than a bare key: it looks authoritative and leads nowhere.

### Punctuation in outbound communication

This rule is **scoped to outbound human communication channels only**, where reads land in front of a colleague, customer, or family member. It is **not** a global stylistic rule. Em-dashes inside code, code comments, repo docs, commit messages, PR descriptions, skill specs, internal markdown, and chat replies to Nathan in Claude Code are all fine.

**In scope (zero tolerance):**

- Slack messages and drafts
- Microsoft Teams messages and drafts
- Email drafts and sends (work and personal)
- SMS / iMessage drafts authored on Nathan's behalf
- Confluence pages, Notion pages, or any wiki surface published to other people
- Any other artifact whose purpose is to deliver prose to a specific human reader

**Out of scope (no rule applies):**

- Source code and code comments
- Repository markdown, READMEs, skill specs, internal docs
- Commit messages, PR descriptions, changelog entries
- Chat responses in Claude Code (Nathan is reading them but they are session-internal)
- Logs, error messages, structured output

**The rule (only when in-scope):**

- **Never use em-dashes (`—`, U+2014) or en-dashes (`–`, U+2013)**. Nathan hates them in messages he sends.
- Replace with whichever fits the sentence:
  - **Colon** (`:`) when introducing or expanding
  - **Comma** (`,`) when adding a parenthetical or aside
  - **Parentheses** (`(...)`) when the aside is a tangent
  - **Period + new sentence** when the dash was hiding two complete thoughts
  - **Plain hyphen with spaces** (` - `) only when nothing else fits naturally
- Applies to **number/letter ranges** in the same surfaces: write `v1-v8` and `S1-S6`, not `v1–v8` / `S1–S6`.
- If editing a comms draft Nathan wrote and it contains em-dashes, leave his alone unless he asks for a scrub. The rule is about what I produce on his behalf, not what he produced.

**Skill-level enforcement:** the `draft-message` and `work-message-drafter` skills should treat this as a hard pre-send gate. Other skills (writing code, editing docs, drafting commits) have no obligation to apply it.
